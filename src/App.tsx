import { useEffect, useRef, useState } from 'react'
import './App.css'
import { CameraError, CameraManager } from './ar/CameraManager'
import { FaceTracker } from './ar/FaceTracker'
import { FaceMeshOverlay } from './ar/FaceMeshOverlay'
import { FaceTrackingState, type TrackingState } from './ar/FaceTrackingState'
import { VideoFrameScheduler } from './ar/VideoFrameScheduler'
import { FaceDebugOverlay } from './ar/FaceDebugOverlay'
import { ARRenderer } from './ar/ARRenderer'
import { ForegroundSegmenter } from './ar/occlusion/ForegroundSegmenter'
import { LightingSampler } from './ar/occlusion/LightEstimator'
import { GLBLoader, disposeLoadedGLB, type LoadedGLB } from './ar/GLBLoader'
import { CalibrationPanel, calibrationToSliderValues, identityCalibration } from './components/CalibrationPanel'
import { DEFAULT_SMOOTHING_SETTINGS, SmoothingPanel, smoothingToSliderValues } from './components/SmoothingPanel'
import { FaceOcclusionPanel, faceOcclusionToSliderValues, type OcclusionStatusView } from './components/FaceOcclusionPanel'
import type { PoseSmoothingSettings } from './ar/PoseSmoother'
import type { Calibration } from './types/Calibration'
import { DEFAULT_FACE_OCCLUSION_SETTINGS, type FaceOcclusionSettings } from './types/FaceOcclusion'
import { logCalibrationDiagnostics } from './utils/CalibrationDiagnostics'
import { mediaPipeTransformationMatrixToFacePose } from './ar/coordinateTransform'
import { isMediaPipeFaceTransformationMatrix } from './ar/FacePose'
import { ProductCarousel } from './components/ProductCarousel'
import { GLBUploadPanel, saveSelectedGLBToFolder } from './components/GLBUploadPanel'
import { createUploadedProduct, chooseLocalModelsFolder } from './products/LocalGLBUploadService'
import { ProductService } from './products/ProductService'
import { GLBAssetAnalyzer } from './ar/glb/GLBAssetAnalyzer'
import { AutoCalibrationEngine } from './ar/glb/AutoCalibrationEngine'
import { GLBDiagnosticPanel } from './components/GLBDiagnosticPanel'
import type { AutoCalibrationResult, GLBAssetAnalysis } from './ar/glb/types'

type CameraUiState = 'landing' | 'requesting' | 'active' | 'denied' | 'unavailable'

const productService = new ProductService()
const glbAnalyzer = new GLBAssetAnalyzer()
const autoCalibrationEngine = new AutoCalibrationEngine()

function TryOnView() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const cameraManagerRef = useRef<CameraManager | null>(null)
  const faceTrackerRef = useRef<FaceTracker | null>(null)
  const trackingStateRef = useRef(new FaceTrackingState())
  const meshOverlayRef = useRef<FaceMeshOverlay | null>(null)
  const frameSchedulerRef = useRef<VideoFrameScheduler | null>(null)
  const faceDebugOverlayRef = useRef<FaceDebugOverlay | null>(null)
  const arRendererRef = useRef<ARRenderer | null>(null)
  const glbLoaderRef = useRef<GLBLoader | null>(null)
  const segmenterRef = useRef<ForegroundSegmenter | null>(null)
  const lightingSamplerRef = useRef(new LightingSampler())
  const faceOcclusionSettingsRef = useRef<FaceOcclusionSettings>({ ...DEFAULT_FACE_OCCLUSION_SETTINGS })
  const arCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [cameraState, setCameraState] = useState<CameraUiState>('landing')
  const [cameraMessage, setCameraMessage] = useState('')
  const [trackingState, setTrackingState] = useState<TrackingState>('searching')
  const [showFaceMesh, setShowFaceMesh] = useState(false)
  const [trackingError, setTrackingError] = useState('')
  const [arError, setArError] = useState('')
  const [calibration, setCalibration] = useState<Calibration>(() => identityCalibration())
  const [autoCalibrationResult, setAutoCalibrationResult] = useState<AutoCalibrationResult | null>(null)
  const [smoothingSettings, setSmoothingSettings] = useState<PoseSmoothingSettings>(() => ({ ...DEFAULT_SMOOTHING_SETTINGS }))
  const [faceOcclusionSettings, setFaceOcclusionSettings] = useState<FaceOcclusionSettings>(() => ({ ...DEFAULT_FACE_OCCLUSION_SETTINGS }))
  const [occlusionStatus, setOcclusionStatus] = useState<OcclusionStatusView | null>(null)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [cameraResolution, setCameraResolution] = useState('Resolution unavailable')
  const [, setProductCatalogVersion] = useState(0)
  const products = productService.listProducts()
  const [selectedProductId, setSelectedProductId] = useState(() => products[0]?.id ?? '')
  const [loadingProductId, setLoadingProductId] = useState<string | null>(null)
  const lastUiTrackingStateRef = useRef<TrackingState>('searching')
  const latestFacePoseRef = useRef<ReturnType<typeof mediaPipeTransformationMatrixToFacePose> | null>(null)
  const activeLoadedModelRef = useRef<LoadedGLB | null>(null)
  const modelsFolderRef = useRef<Awaited<ReturnType<typeof chooseLocalModelsFolder>> | null>(null)
  const uploadedObjectUrlsRef = useRef<string[]>([])
  const uploadSequenceRef = useRef(0)

  useEffect(() => {
    if (cameraState !== 'active' || !arCanvasRef.current) {
      return
    }

    const renderer = new ARRenderer(arCanvasRef.current, {
      onContextError: setArError,
      onRuntimeError: setArError,
    })
    const glbLoader = new GLBLoader()
    arRendererRef.current = renderer
    glbLoaderRef.current = glbLoader
    renderer.setGlassesCalibration(calibration)
    renderer.setPoseSmoothingSettings(smoothingSettings)
    renderer.setFaceOcclusionSettings(faceOcclusionSettings)
    renderer.setFacePose(latestFacePoseRef.current)
    renderer.start()

    return () => {
      renderer.setFacePose(null)
      renderer.clearModel()
      renderer.dispose()
      if (activeLoadedModelRef.current) {
        disposeLoadedGLB(activeLoadedModelRef.current)
        activeLoadedModelRef.current = null
      }
      glbLoader.dispose()
      glbLoaderRef.current = null
      arRendererRef.current = null
    }
  }, [cameraState])

  useEffect(() => {
    if (cameraState !== 'active' || !selectedProductId) {
      return
    }

    const renderer = arRendererRef.current
    const glbLoader = glbLoaderRef.current
    if (!renderer || !glbLoader) {
      return
    }

    let cancelled = false
    let product: ReturnType<ProductService['getProductById']>

    try {
      product = productService.getProductById(selectedProductId)
    } catch (error) {
      setArError(error instanceof Error ? error.message : 'The selected eyewear product could not be resolved.')
      setLoadingProductId(null)
      return
    }

    setArError('')
    setLoadingProductId(product.id)

    void glbLoader.load(product.model)
      .then((loadedModel) => {
        if (cancelled || arRendererRef.current !== renderer || glbLoaderRef.current !== glbLoader) {
          disposeLoadedGLB(loadedModel)
          return
        }

        const previousModel = activeLoadedModelRef.current

        // Perform single-pass GLB geometry analysis & auto calibration
        try {
          const analysis = glbAnalyzer.analyzeAsset(loadedModel.scene)
          const result = autoCalibrationEngine.computeAutoCalibration(analysis, null)
          setAutoCalibrationResult(result)

          const activeCalibration = result.isAutoApplied ? result.finalCalibration : product.calibration
          renderer.setGlassesCalibration(activeCalibration)
          renderer.setModel(result.normalization.runtimeRoot)
          activeLoadedModelRef.current = loadedModel
          setCalibration(activeCalibration)
        } catch (analysisErr) {
          // Fallback if analysis fails on unusual mesh
          renderer.setGlassesCalibration(product.calibration)
          renderer.setModel(loadedModel.scene)
          activeLoadedModelRef.current = loadedModel
          setCalibration(product.calibration)
          setAutoCalibrationResult(null)
        }

        setLoadingProductId(null)

        if (previousModel && previousModel !== loadedModel) {
          disposeLoadedGLB(previousModel)
        }
      })
      .catch((error) => {
        if (cancelled || arRendererRef.current !== renderer || glbLoaderRef.current !== glbLoader) {
          return
        }

        setLoadingProductId(null)
        setArError(
          error instanceof Error
            ? `Eyewear model could not be loaded: ${error.message}`
            : 'Eyewear model could not be loaded.',
        )
      })

    return () => {
      cancelled = true
    }
  }, [cameraState, selectedProductId])

  useEffect(() => {
    faceOcclusionSettingsRef.current = faceOcclusionSettings
  }, [faceOcclusionSettings])

  useEffect(() => {
    if (!diagnosticsOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDiagnosticsOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [diagnosticsOpen])

  useEffect(() => {
    if (cameraState !== 'active') {
      setOcclusionStatus(null)
      setCameraResolution('Resolution unavailable')
      return
    }

    // Publish only actual resolution changes; never mirror per-frame data into React state.
    const resolutionTimer = window.setInterval(() => {
      const video = videoRef.current
      const nextResolution = video?.videoWidth && video?.videoHeight
        ? `${video.videoWidth} × ${video.videoHeight} px`
        : 'Resolution unavailable'
      setCameraResolution((current) => current === nextResolution ? current : nextResolution)
    }, 1000)

    // Only publish when something the panel shows actually changed: publishing
    // re-renders this component, which re-runs the inline canvas ref callbacks.
    let lastSignature = ''
    const id = window.setInterval(() => {
      const renderer = arRendererRef.current
      if (!renderer) return
      const segmenter = segmenterRef.current
      const occlusion = renderer.getOcclusionStatus()
      const view: OcclusionStatusView = {
        occlusion,
        segmenter: segmenter?.getStatus() ?? 'idle',
        segmenterMessage: segmenter?.getStatusMessage() ?? '',
        segmenterMs: segmenter?.getAverageDurationMs() ?? 0,
      }
      const signature = [
        occlusion.occluder.mode,
        occlusion.occluder.hasSurface,
        occlusion.occluder.confidence.toFixed(2),
        occlusion.fit.verdict,
        occlusion.fit.embeddedFraction.toFixed(2),
        occlusion.fit.suggestedForwardCm.toFixed(1),
        occlusion.appliedClearanceCm.toFixed(1),
        occlusion.foregroundMaskActive,
        occlusion.cameraFovDeg.toFixed(1),
        view.segmenter,
        view.segmenterMessage,
        Math.round(view.segmenterMs),
      ].join('|')
      if (signature !== lastSignature) {
        lastSignature = signature
        setOcclusionStatus(view)
      }
    }, 500)

    return () => {
      window.clearInterval(id)
      window.clearInterval(resolutionTimer)
    }
  }, [cameraState])

  useEffect(() => {
    const initialCalibration = identityCalibration()
    logCalibrationDiagnostics(initialCalibration, {
      source: 'init',
      sliderValues: {
        ...calibrationToSliderValues(initialCalibration),
        ...smoothingToSliderValues(DEFAULT_SMOOTHING_SETTINGS),
        ...faceOcclusionToSliderValues(DEFAULT_FACE_OCCLUSION_SETTINGS),
      },
      smoothing: DEFAULT_SMOOTHING_SETTINGS,
      occlusion: DEFAULT_FACE_OCCLUSION_SETTINGS,
    })
  }, [])

  useEffect(() => {
    const manager = new CameraManager()
    cameraManagerRef.current = manager

    const tracker = new FaceTracker()
    const meshOverlay = new FaceMeshOverlay()
    const debugOverlay = new FaceDebugOverlay()
    faceTrackerRef.current = tracker
    segmenterRef.current = new ForegroundSegmenter()
    meshOverlayRef.current = meshOverlay
    faceDebugOverlayRef.current = debugOverlay

    if (videoRef.current) {
      manager.attachVideoElement(videoRef.current)
    }

    return () => {
      arRendererRef.current?.dispose()
      arRendererRef.current = null
      glbLoaderRef.current?.dispose()
      glbLoaderRef.current = null
      frameSchedulerRef.current?.dispose()
      frameSchedulerRef.current = null
      tracker.dispose()
      segmenterRef.current?.dispose()
      segmenterRef.current = null
      meshOverlay.dispose()
      debugOverlay.dispose()
      manager.dispose()
      cameraManagerRef.current = null
      faceTrackerRef.current = null
      meshOverlayRef.current = null
      faceDebugOverlayRef.current = null
      for (const objectUrl of uploadedObjectUrlsRef.current) {
        URL.revokeObjectURL(objectUrl)
      }
      uploadedObjectUrlsRef.current = []
    }
  }, [])

  const stopTrackingPreview = () => {
    frameSchedulerRef.current?.stop()
    frameSchedulerRef.current = null
  }

  const startInference = async () => {
    const video = videoRef.current
    const tracker = faceTrackerRef.current
    if (!video || !tracker) return

    setTrackingError('')
    try {
      await tracker.initialize()
    } catch (error) {
      setTrackingError(error instanceof Error ? error.message : 'Face tracking could not be initialized.')
      return
    }

    stopTrackingPreview()
    trackingStateRef.current.reset()
    lastUiTrackingStateRef.current = 'searching'
    setTrackingState('searching')

    const scheduler = new VideoFrameScheduler(video, tracker, {
      onFrame: (result) => {
        arRendererRef.current?.setVideoSourceDimensions(video.videoWidth, video.videoHeight)
        const selection = trackingStateRef.current.update(result.result)

        if (selection.state !== lastUiTrackingStateRef.current) {
          lastUiTrackingStateRef.current = selection.state
          setTrackingState(selection.state)
        }

        const primaryFaceIndex = selection.primaryFaceIndex
        const transformationMatrix = primaryFaceIndex === null
          ? undefined
          : result.result.facialTransformationMatrixes[primaryFaceIndex]

        if (
          selection.state === 'detected' &&
          transformationMatrix &&
          isMediaPipeFaceTransformationMatrix(transformationMatrix)
        ) {
          try {
            const facePose = mediaPipeTransformationMatrixToFacePose(
              transformationMatrix,
              selection.state,
              result.timestampMs,
            )
            latestFacePoseRef.current = facePose
            arRendererRef.current?.setFacePose(facePose)
          } catch (error) {
            latestFacePoseRef.current = null
            arRendererRef.current?.setFacePose(null)
            arRendererRef.current?.setFaceLandmarks(null)
            setTrackingError(
              error instanceof Error
                ? error.message
                : 'Face pose conversion failed.',
            )
          }
        } else {
          latestFacePoseRef.current = null
          arRendererRef.current?.setFacePose(null)
          arRendererRef.current?.setFaceLandmarks(null)
        }

        const selectedLandmarks = selection.primaryFaceIndex === null
          ? null
          : result.result.faceLandmarks[selection.primaryFaceIndex] ?? null
        arRendererRef.current?.setFaceLandmarks(
          selection.state === 'detected' ? selectedLandmarks : null,
        )

        // Optional layers. Both are lazy and non-blocking: face tracking and the
        // depth occluder never wait for them.
        const occlusionSettings = faceOcclusionSettingsRef.current
        if (selection.state === 'detected' && selectedLandmarks && occlusionSettings.enabled) {
          const now = performance.now()

          if (occlusionSettings.foregroundMaskEnabled) {
            const segmenter = segmenterRef.current
            if (segmenter) {
              if (segmenter.getStatus() === 'idle') void segmenter.initialize()
              const mask = segmenter.process(video, selectedLandmarks, now)
              if (mask) arRendererRef.current?.setForegroundMask(mask)
            }
          }

          if (occlusionSettings.lightingMatchEnabled) {
            const sample = lightingSamplerRef.current.sample(video, selectedLandmarks, now)
            if (sample) arRendererRef.current?.setLightingSample(sample)
          }
        } else {
          arRendererRef.current?.setForegroundMask(null)
        }

        meshOverlayRef.current?.render(
          result,
          selection.primaryFaceIndex,
          video,
          selection.bounds,
        )
        faceDebugOverlayRef.current?.render(
          result,
          selection.primaryFaceIndex,
          selection.bounds,
          latestFacePoseRef.current,
        )
      },
      onError: (error) => {
        setTrackingError(error instanceof Error ? error.message : 'Face tracking failed.')
      },
    })

    frameSchedulerRef.current = scheduler
    scheduler.start()
  }

  const toggleFaceMesh = () => {
    const nextValue = !showFaceMesh
    setShowFaceMesh(nextValue)

    if (!nextValue) {
      meshOverlayRef.current?.clear()
    }
  }

  const startCamera = async () => {
    const manager = cameraManagerRef.current

    if (!manager) {
      setCameraState('unavailable')
      setCameraMessage('The camera service is not available. Please reload the page and try again.')
      return
    }

    setCameraState('requesting')
    setCameraMessage('Requesting camera access…')

    try {
      await manager.start()
      setCameraState('active')
      setCameraMessage('Camera access is active.')
      await startInference()
    } catch (error) {
      const cameraError = error instanceof CameraError ? error : null

      if (cameraError?.code === 'permission-denied') {
        setCameraState('denied')
        setCameraMessage('Camera permission is blocked. Enable camera access in your browser settings, then retry.')
        return
      }

      setCameraState('unavailable')
      setCameraMessage(
        cameraError?.message ?? 'The camera could not be started. Check your browser and camera, then try again.',
      )
    }
  }

  const updateCalibration = (
    nextCalibration: Calibration,
    source: 'change' | 'reset' = 'change',
  ) => {
    setCalibration(nextCalibration)
    arRendererRef.current?.setGlassesCalibration(nextCalibration)

    logCalibrationDiagnostics(nextCalibration, {
      source,
      sliderValues: {
        ...calibrationToSliderValues(nextCalibration),
        ...smoothingToSliderValues(smoothingSettings),
        ...faceOcclusionToSliderValues(faceOcclusionSettings),
      },
      smoothing: smoothingSettings,
      occlusion: faceOcclusionSettings,
    })
  }

  const resetCalibration = () => {
    const nextCalibration = identityCalibration()
    updateCalibration(nextCalibration, 'reset')
  }

  const updateSmoothingSettings = (nextSettings: PoseSmoothingSettings, source: 'change' | 'reset' = 'change') => {
    setSmoothingSettings(nextSettings)
    arRendererRef.current?.setPoseSmoothingSettings(nextSettings)
    logCalibrationDiagnostics(calibration, {
      source: source === 'reset' ? 'reset' : 'change',
      sliderValues: {
        ...calibrationToSliderValues(calibration),
        ...smoothingToSliderValues(nextSettings),
        ...faceOcclusionToSliderValues(faceOcclusionSettings),
      },
      smoothing: nextSettings,
      occlusion: faceOcclusionSettings,
    })
  }

  const resetSmoothing = () => {
    updateSmoothingSettings({ ...DEFAULT_SMOOTHING_SETTINGS }, 'reset')
  }

  const updateFaceOcclusion = (nextSettings: FaceOcclusionSettings, source: 'change' | 'reset' = 'change') => {
    setFaceOcclusionSettings(nextSettings)
    arRendererRef.current?.setFaceOcclusionSettings(nextSettings)
    logCalibrationDiagnostics(calibration, {
      source,
      sliderValues: {
        ...calibrationToSliderValues(calibration),
        ...smoothingToSliderValues(smoothingSettings),
        ...faceOcclusionToSliderValues(nextSettings),
      },
      smoothing: smoothingSettings,
      occlusion: nextSettings,
    })
  }

  const resetFaceOcclusion = () => {
    updateFaceOcclusion({ ...DEFAULT_FACE_OCCLUSION_SETTINGS }, 'reset')
  }

  /**
   * Make the automatic anatomical clearance permanent by adding it to this
   * product's calibration Z. The automatic lift then decays to ~0 because the
   * frame is no longer embedded, so the glasses do not visibly move.
   */
  const bakeClearance = (clearanceCm: number) => {
    if (!(clearanceCm > 0)) return
    updateCalibration({ ...calibration, z: Number((calibration.z + clearanceCm).toFixed(3)) }, 'change')
  }

  const exportCalibration = () => {
    const json = JSON.stringify(calibration, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'aviator-001-calibration.json'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)

    logCalibrationDiagnostics(calibration, {
      source: 'export',
      sliderValues: {
        ...calibrationToSliderValues(calibration),
        ...smoothingToSliderValues(smoothingSettings),
        ...faceOcclusionToSliderValues(faceOcclusionSettings),
      },
      smoothing: smoothingSettings,
      occlusion: faceOcclusionSettings,
    })
  }

  const exportSmoothing = () => {
    const json = JSON.stringify(smoothingSettings, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'motion-smoothing.json'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)

    logCalibrationDiagnostics(calibration, {
      source: 'export',
      sliderValues: {
        ...calibrationToSliderValues(calibration),
        ...smoothingToSliderValues(smoothingSettings),
        ...faceOcclusionToSliderValues(faceOcclusionSettings),
      },
      smoothing: smoothingSettings,
      occlusion: faceOcclusionSettings,
    })
  }

  const exportFaceOcclusion = () => {
    const json = JSON.stringify(faceOcclusionSettings, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'face-occlusion.json'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)

    logCalibrationDiagnostics(calibration, {
      source: 'export',
      sliderValues: {
        ...calibrationToSliderValues(calibration),
        ...smoothingToSliderValues(smoothingSettings),
        ...faceOcclusionToSliderValues(faceOcclusionSettings),
      },
      smoothing: smoothingSettings,
      occlusion: faceOcclusionSettings,
    })
  }

  const selectModelsFolder = async () => {
    modelsFolderRef.current = await chooseLocalModelsFolder()
  }

  const uploadGLB = async (file: File, displayName: string) => {
    if (!modelsFolderRef.current) {
      modelsFolderRef.current = await chooseLocalModelsFolder()
    }

    await saveSelectedGLBToFolder(modelsFolderRef.current, file, displayName)
    uploadSequenceRef.current += 1
    const { product, result } = createUploadedProduct(file, displayName, uploadSequenceRef.current)
    productService.registerUploadedProduct(product)
    uploadedObjectUrlsRef.current.push(result.objectUrl)
    setProductCatalogVersion((version) => version + 1)
    setSelectedProductId(product.id)
    setCalibration(product.calibration)
  }

  const stopCamera = () => {
    stopTrackingPreview()
    latestFacePoseRef.current = null
    arRendererRef.current?.setFacePose(null)
    arRendererRef.current?.setFaceLandmarks(null)
    arRendererRef.current?.setForegroundMask(null)
    meshOverlayRef.current?.clear()
    faceDebugOverlayRef.current?.clear()
    trackingStateRef.current.reset()
    setTrackingState('searching')
    setShowFaceMesh(false)
    setTrackingError('')
    setArError('')
    cameraManagerRef.current?.stop()
    setCameraState('landing')
    setCameraMessage('')
  }

  return (
    <main className="try-on-view">
      <div className="try-on-main">
        <section className={`try-on-surface ${cameraState === 'active' ? 'try-on-surface--camera-active' : ''}`} aria-label="Try-on surface">
        <div className="camera-stage">
          <video
            ref={videoRef}
            className="camera-source"
            playsInline
            muted
            autoPlay
            aria-label="Live camera preview"
          />
          <canvas
            ref={(canvas) => {
              arCanvasRef.current = canvas
            }}
            className="ar-renderer-canvas"
            aria-hidden="true"
          />
          <canvas
            ref={(canvas) => {
              if (canvas && meshOverlayRef.current) {
                meshOverlayRef.current.attach(canvas)
                const rect = canvas.parentElement?.getBoundingClientRect()
                if (rect) meshOverlayRef.current.resize(rect.width, rect.height)
              }
            }}
            className={`face-mesh-overlay ${showFaceMesh ? 'face-mesh-overlay--visible' : ''}`}
            aria-hidden="true"
          />
          <div className="camera-overlay" aria-hidden="true" />
          <pre
            ref={(element) => {
              if (element && faceDebugOverlayRef.current) {
                faceDebugOverlayRef.current.attach(element)
              }
            }}
            className="face-debug-overlay"
            aria-label="Face tracking diagnostics"
          >
            Face: searching
            {'\n'}Pose: unavailable
          </pre>
        </div>

        {arError && cameraState === 'active' && (
          <p className="tracking-error tracking-error--renderer" role="alert">{arError}</p>
        )}

        {trackingError && cameraState === 'active' && (
          <p className="tracking-error" role="alert">{trackingError}</p>
        )}

        <div className="camera-permission" aria-live="polite">
          {cameraState === 'landing' && (
            <div className="camera-permission__content">
              <p className="eyebrow">Camera access</p>
              <h2>Try eyewear on virtually</h2>
              <p>
                Your camera is used in this browser to position the try-on experience. Camera access starts only when you choose to begin.
              </p>
              <button type="button" className="camera-permission__button" onClick={startCamera}>
                Start Try-On
              </button>
            </div>
          )}

          {cameraState === 'requesting' && (
            <div className="camera-permission__content">
              <p className="eyebrow">Camera access</p>
              <h2>Allow camera access</h2>
              <p>{cameraMessage}</p>
            </div>
          )}

          {cameraState === 'active' && (
            <div className="camera-active-controls">
              <span className="camera-active-controls__status">Camera ready</span>
              <span className={`tracking-status tracking-status--${trackingState}`}>Face: {trackingState}</span>
              <button type="button" className="camera-permission__button camera-permission__button--secondary" onClick={toggleFaceMesh}>
                {showFaceMesh ? 'Hide Face Mesh' : 'Show Face Mesh'}
              </button>
              <button type="button" className="camera-permission__button camera-permission__button--secondary" onClick={stopCamera}>
                Stop Camera
              </button>
            </div>
          )}

          {cameraState === 'denied' && (
            <div className="camera-permission__content">
              <p className="eyebrow">Camera permission</p>
              <h2>Camera access is required</h2>
              <p>{cameraMessage}</p>
              <button type="button" className="camera-permission__button" onClick={startCamera}>
                Retry
              </button>
            </div>
          )}

          {cameraState === 'unavailable' && (
            <div className="camera-permission__content">
              <p className="eyebrow">Camera unavailable</p>
              <h2>We could not start the camera</h2>
              <p>{cameraMessage}</p>
              <button type="button" className="camera-permission__button" onClick={startCamera}>
                Retry
              </button>
            </div>
          )}
        </div>
        </section>

        <ProductCarousel
          products={products}
          selectedProductId={selectedProductId}
          loadingProductId={loadingProductId}
          error={arError}
          onSelect={setSelectedProductId}
        />
      </div>

      <aside hidden aria-hidden="true" className="product-controls product-controls--calibration" aria-label="Developer controls">
        <GLBUploadPanel folderSelected={modelsFolderRef.current !== null} onChooseFolder={selectModelsFolder} onUpload={uploadGLB} />
        <GLBDiagnosticPanel result={autoCalibrationResult} modelUrl={products.find((p) => p.id === selectedProductId)?.model}
          onApplyAutoCalibration={() => {
            if (activeLoadedModelRef.current) {
              const analysis = glbAnalyzer.analyzeAsset(activeLoadedModelRef.current.scene)
              const result = autoCalibrationEngine.computeAutoCalibration(analysis, null)
              setAutoCalibrationResult(result)
              updateCalibration(result.finalCalibration, 'change')
            }
          }}
          onResetManualCorrection={() => { if (autoCalibrationResult) updateCalibration(autoCalibrationResult.autoCalibration, 'reset') }} />
        <CalibrationPanel calibration={calibration} onChange={updateCalibration} onReset={resetCalibration} onExport={exportCalibration} />
        <SmoothingPanel settings={smoothingSettings} onChange={updateSmoothingSettings} onReset={resetSmoothing} onExport={exportSmoothing} />
        <FaceOcclusionPanel settings={faceOcclusionSettings} status={occlusionStatus} onBakeClearance={bakeClearance}
          onChange={updateFaceOcclusion} onReset={resetFaceOcclusion} onExport={exportFaceOcclusion} />
      </aside>

      <section className={`system-drawer ${diagnosticsOpen ? 'system-drawer--open' : ''}`} aria-label="AR system diagnostics">
        <button className="system-drawer__toggle" type="button" aria-expanded={diagnosticsOpen}
          aria-controls="system-drawer-content" onClick={() => setDiagnosticsOpen((open) => !open)}>
          <span className="system-drawer__signal" aria-hidden="true" />
          <span>AR SYSTEM / {cameraState === 'active' ? 'LIVE TELEMETRY' : 'STANDBY'}</span>
          <span className="system-drawer__summary">CAM {cameraState.toUpperCase()} · FACE {trackingState.toUpperCase()}</span>
          <span className="system-drawer__chevron" aria-hidden="true">{diagnosticsOpen ? '−' : '+'}</span>
        </button>
        <div id="system-drawer-content" className="system-drawer__content" aria-hidden={!diagnosticsOpen} inert={!diagnosticsOpen}>
          <div className="system-drawer__heading"><span>RUNTIME OBSERVABILITY</span><span>LOCAL · ON-DEVICE</span></div>
          <div className="system-drawer__grid">
            <article className="system-readout"><span className="system-readout__index">01 / INPUT</span><h3>CAMERA</h3>
              <strong>{cameraState === 'active' ? 'STREAM ACTIVE' : cameraState.toUpperCase()}</strong>
              <p>{cameraResolution}</p>
              <small>{cameraMessage || 'Camera starts only after user permission.'}</small>
            </article>
            <article className="system-readout"><span className="system-readout__index">02 / VISION</span><h3>FACE TRACKING</h3>
              <strong>{trackingState.toUpperCase()}</strong><p>{latestFacePoseRef.current ? 'Transformation matrix received' : 'Awaiting valid face pose'}</p>
              <small>{trackingError || 'Single-face pose tracking runs locally in the browser.'}</small>
            </article>
            <article className="system-readout"><span className="system-readout__index">03 / ASSET</span><h3>EYEWEAR MODEL</h3>
              <strong>{loadingProductId ? 'LOADING MODEL' : activeLoadedModelRef.current ? 'MODEL ACTIVE' : 'NO MODEL ACTIVE'}</strong>
              <p>{products.find((product) => product.id === selectedProductId)?.name ?? 'No product selected'}</p>
              <small>{autoCalibrationResult ? `Auto-calibration: ${autoCalibrationResult.isAutoApplied ? 'applied' : 'not applied'}` : 'Product calibration is supplied by catalog data.'}</small>
            </article>
            <article className="system-readout"><span className="system-readout__index">04 / OCCLUSION</span><h3>DEPTH & MASK</h3>
              <strong>{occlusionStatus?.occlusion.foregroundMaskActive ? 'FOREGROUND MASK ACTIVE' : occlusionStatus?.occlusion.occluder.hasSurface ? 'FACE DEPTH ACTIVE' : 'STATUS PENDING'}</strong>
              <p>{occlusionStatus ? `Mode: ${occlusionStatus.occlusion.occluder.mode}` : 'Occlusion telemetry unavailable'}</p>
              <small>{occlusionStatus ? `Segmenter: ${occlusionStatus.segmenter}; avg ${Math.round(occlusionStatus.segmenterMs)} ms` : 'Status is reported by the active renderer and segmenter.'}</small>
            </article>
          </div>
          <div className="system-drawer__foot"><span>PROCESSING: BROWSER DEVICE</span><span>CAMERA FRAMES ARE NOT UPLOADED</span><span>WEBGL: {cameraState === 'active' ? (arError ? 'DEGRADED' : 'INITIALIZED') : 'IDLE'}</span></div>
        </div>
      </section>
    </main>
  )
}

function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup" aria-label="Forma eyewear virtual try-on">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <div>
            <p className="eyebrow">FORMA / VIRTUAL OPTICS</p>
            <h1>TRY ON<span>—</span></h1>
          </div>
        </div>
        <span className="app-header__status"><span className="status-dot" /> LIVE DEMO</span>
      </header>
      <TryOnView />
    </div>
  )
}

export default App
