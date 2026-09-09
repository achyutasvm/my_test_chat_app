"use client";

import { ReactNode } from "react";
import { Info, PanelRightClose } from "lucide-react";

export type ReasoningLevel = "minimal" | "low" | "medium" | "high";

export interface ModelParams {
  temperature: number;
  maxOutputTokens: number;
  topP: number;
  topK: number | null;
  frequencyPenalty: number;
  presencePenalty: number;
  stopSequences: string;
  seed: number | null;
  reasoningLevel: ReasoningLevel;
  stream: boolean;
  jsonMode: boolean;
}

export const DEFAULT_MODEL_PARAMS: ModelParams = {
  temperature: 1,
  maxOutputTokens: 2048,
  topP: 1,
  topK: null,
  frequencyPenalty: 0,
  presencePenalty: 0,
  stopSequences: "",
  seed: null,
  reasoningLevel: "medium",
  stream: true,
  jsonMode: false,
};

function Tooltip({ text }: { text: string }) {
  return (
    <span className="relative inline-flex group/tooltip">
      <Info size={13} className="text-gray-400 cursor-help" />
      <span className="pointer-events-none absolute left-1/2 bottom-full z-20 mb-2 w-56 -translate-x-1/2 rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs leading-snug text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/tooltip:opacity-100">
        {text}
      </span>
    </span>
  );
}

function FieldLabel({ label, tooltip }: { label: string; tooltip: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <span className="text-sm font-medium text-gray-800">{label}</span>
      <Tooltip text={tooltip} />
    </div>
  );
}

const inputClass =
  "w-full px-2.5 py-1.5 text-sm text-gray-800 border border-gray-200 rounded-md bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";

function SliderField({
  label,
  tooltip,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  tooltip: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-gray-800">{label}</span>
          <Tooltip text={tooltip} />
        </div>
        <input
          type="number"
          value={value}
          min={min}
          step={step}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
          className="w-20 px-2 py-1 text-sm text-right text-gray-800 border border-gray-200 rounded-md bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(Math.max(value, min), max)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-gray-900"
      />
    </div>
  );
}

function Field({
  label,
  tooltip,
  children,
}: {
  label: string;
  tooltip: string;
  children: ReactNode;
}) {
  return (
    <div>
      <FieldLabel label={label} tooltip={tooltip} />
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  tooltip,
  checked,
  onChange,
}: {
  label: string;
  tooltip: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-medium text-gray-800">{label}</span>
        <Tooltip text={tooltip} />
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-gray-900" : "bg-gray-200"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

export default function ModelSettingsPanel({
  params,
  onChange,
  onClose,
}: {
  params: ModelParams;
  onChange: (params: ModelParams) => void;
  onClose: () => void;
}) {
  const update = <K extends keyof ModelParams>(key: K, value: ModelParams[K]) =>
    onChange({ ...params, [key]: value });

  return (
    <div className="w-80 flex-shrink-0 border-l border-gray-200 bg-white overflow-y-auto">
      <div className="p-4 space-y-6">
        <div className="flex items-center justify-between sticky top-0 bg-white pb-1">
          <h2 className="text-xs font-semibold tracking-wider text-gray-500">
            PARAMETERS
          </h2>
          <button
            onClick={onClose}
            title="Hide parameters"
            className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 transition-colors"
          >
            <PanelRightClose size={16} />
          </button>
        </div>

        <SliderField
          label="Temperature"
          tooltip="Controls randomness in the output. Lower values are more focused and deterministic, higher values are more creative and varied."
          value={params.temperature}
          min={0}
          max={2}
          step={0.01}
          onChange={(v) => update("temperature", Math.min(Math.max(v, 0), 2))}
        />

        <SliderField
          label="Max Completion Tokens"
          tooltip="The maximum number of tokens the model can generate in its response."
          value={params.maxOutputTokens}
          min={1}
          max={8192}
          step={1}
          onChange={(v) =>
            update("maxOutputTokens", Math.max(1, Math.round(v)))
          }
        />

        <SliderField
          label="Top P"
          tooltip="Nucleus sampling: only tokens whose cumulative probability mass is within this threshold are considered. Lower values are less random."
          value={params.topP}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => update("topP", Math.min(Math.max(v, 0), 1))}
        />

        <Field
          label="Top K"
          tooltip="At each step, only the K most likely next tokens are considered for sampling. Leave blank to use the model's default."
        >
          <input
            type="number"
            min={1}
            step={1}
            placeholder="Any"
            value={params.topK ?? ""}
            onChange={(e) => {
              const raw = e.target.value;
              update(
                "topK",
                raw === "" ? null : Math.max(1, Math.round(Number(raw))),
              );
            }}
            className={inputClass}
          />
        </Field>

        <SliderField
          label="Frequency Penalty"
          tooltip="Penalizes tokens based on how often they've already appeared, reducing verbatim repetition. Negative values encourage repetition."
          value={params.frequencyPenalty}
          min={-2}
          max={2}
          step={0.01}
          onChange={(v) =>
            update("frequencyPenalty", Math.min(Math.max(v, -2), 2))
          }
        />

        <SliderField
          label="Presence Penalty"
          tooltip="Penalizes tokens that have appeared at all so far, encouraging the model to introduce new topics. Negative values encourage staying on topic."
          value={params.presencePenalty}
          min={-2}
          max={2}
          step={0.01}
          onChange={(v) =>
            update("presencePenalty", Math.min(Math.max(v, -2), 2))
          }
        />

        <Field
          label="Stop Sequence"
          tooltip="Comma-separated sequences. Generation stops as soon as one of these is produced."
        >
          <input
            type="text"
            placeholder="e.g. END, ###"
            value={params.stopSequences}
            onChange={(e) => update("stopSequences", e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field
          label="Seed"
          tooltip="If set, the model makes a best effort to sample deterministically, so repeated requests with the same seed tend to return the same response. Leave blank for random."
        >
          <input
            type="number"
            step={1}
            placeholder="Random"
            value={params.seed ?? ""}
            onChange={(e) => {
              const raw = e.target.value;
              update("seed", raw === "" ? null : Math.round(Number(raw)));
            }}
            className={inputClass}
          />
        </Field>

        <Field
          label="Reasoning"
          tooltip="Controls how much internal reasoning effort the model spends before producing a response."
        >
          <select
            value={params.reasoningLevel}
            onChange={(e) =>
              update("reasoningLevel", e.target.value as ReasoningLevel)
            }
            className={inputClass}
          >
            <option value="minimal">Minimal</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </Field>

        <ToggleRow
          label="Stream"
          tooltip="Stream the response token-by-token as it's generated instead of waiting for the full reply."
          checked={params.stream}
          onChange={(v) => update("stream", v)}
        />

        <ToggleRow
          label="JSON Mode"
          tooltip="Constrain the model to always return a syntactically valid JSON response."
          checked={params.jsonMode}
          onChange={(v) => update("jsonMode", v)}
        />
      </div>
    </div>
  );
}
