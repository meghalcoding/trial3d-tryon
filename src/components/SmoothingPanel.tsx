import { useState } from 'react'
import type { PoseSmoothingSettings } from '../ar/PoseSmoother'

export interface SmoothingPanelProps {
  readonly settings: PoseSmoothingSettings
  readonly onChange: (settings: PoseSmoothingSettings) => void
  readonly onReset: () => void
  readonly onExport: () => void
}

type SmoothingKey = keyof PoseSmoothingSettings

type SliderSpec = {
  readonly key: SmoothingKey
  readonly label: string
  readonly min: number
  readonly max: number
  readonly step: number
  readonly help: string
}

const SLIDER_MIN = 0
const SLIDER_MAX = 100

const SLIDER_SPECS: readonly SliderSpec[] = [
  {
    key: 'positionHalfLifeSeconds',
    label: 'Position / scale response',
    min: 0.02,
    max: 0.3,
    step: 0.001,
    help: 'Lower = faster/snappier movement. Higher = smoother/slower movement.',
  },
  {
    key: 'rotationHalfLifeSeconds',
    label: 'Rotation response',
    min: 0.02,
    max: 0.3,
    step: 0.001,
    help: 'Lower = faster head rotation response. Higher = more damped rotation.',
  },
]

export const DEFAULT_SMOOTHING_SETTINGS: PoseSmoothingSettings = Object.freeze({
  positionHalfLifeSeconds: 0.08,
  rotationHalfLifeSeconds: 0.08,
})

export function smoothingToSliderValues(
  settings: PoseSmoothingSettings,
): Partial<Record<SmoothingKey, number>> {
  return Object.fromEntries(
    SLIDER_SPECS.map((spec) => [spec.key, toSliderValue(settings[spec.key], spec)]),
  ) as Partial<Record<SmoothingKey, number>>
}

function toSliderValue(value: number, spec: SliderSpec): number {
  const normalized = (value - spec.min) / (spec.max - spec.min)
  return Math.round(Math.min(1, Math.max(0, normalized)) * SLIDER_MAX)
}

function fromSliderValue(sliderValue: number, spec: SliderSpec): number {
  const normalized = sliderValue / SLIDER_MAX
  const raw = spec.min + normalized * (spec.max - spec.min)
  const precision = Math.max(0, Math.ceil(-Math.log10(spec.step)))
  const factor = 10 ** precision
  return Math.round(raw * factor) / factor
}

export function SmoothingPanel({
  settings,
  onChange,
  onReset,
  onExport,
}: SmoothingPanelProps) {
  const [activeKey, setActiveKey] = useState<SmoothingKey | null>(null)

  const updateValue = (spec: SliderSpec, sliderValue: number) => {
    setActiveKey(spec.key)
    onChange({
      ...settings,
      [spec.key]: fromSliderValue(sliderValue, spec),
    })
  }

  return (
    <section className="smoothing-panel" aria-label="Motion smoothing controls">
      <div className="smoothing-panel__header">
        <div>
          <p className="eyebrow">Motion</p>
          <h2>Tracking smoothing</h2>
          <p className="smoothing-panel__description">
            Lower half-life values respond faster; higher values produce smoother, more damped motion.
          </p>
        </div>
        <span className="calibration-panel__active" aria-live="polite">
          {activeKey ? `${activeKey} adjusted` : 'Live'}
        </span>
      </div>

      <div className="calibration-panel__controls">
        {SLIDER_SPECS.map((spec) => {
          const value = settings[spec.key]
          const sliderValue = toSliderValue(value, spec)
          const inputId = `smoothing-${spec.key}`

          return (
            <div className="calibration-control" key={spec.key}>
              <div className="calibration-control__header">
                <label htmlFor={inputId}>{spec.label}</label>
                <output htmlFor={inputId}>{value.toFixed(3)} s</output>
              </div>
              <input
                id={inputId}
                type="range"
                min={SLIDER_MIN}
                max={SLIDER_MAX}
                step={1}
                value={sliderValue}
                onChange={(event) => updateValue(spec, Number(event.target.value))}
                aria-label={spec.label}
              />
              <div className="calibration-control__meta">
                <span>{spec.min.toFixed(2)} s</span>
                <span>{spec.help}</span>
                <span>{spec.max.toFixed(2)} s</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="calibration-panel__actions">
        <button type="button" className="calibration-button calibration-button--secondary" onClick={onReset}>
          Reset
        </button>
        <button type="button" className="calibration-button" onClick={onExport}>
          Export Motion JSON
        </button>
      </div>
    </section>
  )
}
