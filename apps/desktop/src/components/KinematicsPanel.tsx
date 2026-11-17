import { Calculator, X } from "lucide-react";
import { useState } from "react";
import { getLayout } from "@/scene/layouts";
import { useAppStore } from "@/store/useAppStore";

type NumberFieldProps = {
  id: string;
  label: string;
  unit: string;
  value: string;
  onChange: (value: string) => void;
};

const CONSTANT_ACCELERATION_MPS2 = 1;

function NumberField({ id, label, unit, value, onChange }: NumberFieldProps) {
  return (
    <label htmlFor={id} className="flex min-w-0 flex-col gap-1 text-[11px] font-medium text-slate-600">
      {label} <span className="font-normal text-slate-400">({unit})</span>
      <input
        id={id}
        type="number"
        step="any"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-900 outline-none focus:border-[#1a73e8]"
      />
    </label>
  );
}

function ReadOnlyField({ label, unit, value }: { label: string; unit: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 text-[11px] font-medium text-slate-600">
      {label} <span className="font-normal text-slate-400">({unit})</span>
      <output className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm text-slate-700">
        {value}
      </output>
    </div>
  );
}

function parseNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number) {
  return Number(value.toFixed(3)).toString();
}

export function KinematicsPanel() {
  const [open, setOpen] = useState(true);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [time, setTime] = useState("1");
  const scene = useAppStore((state) => state.scenes.find((item) => item.id === state.selectedId));
  const layout = scene ? getLayout(scene.id) : undefined;
  const collisionVehicleIds = layout?.collision?.vehicleIds;
  const vehicles = scene
    ? collisionVehicleIds
      ? scene.vehicles.filter((vehicle) => collisionVehicleIds.includes(vehicle.id))
      : scene.vehicles
    : [];
  const selectedVehicle =
    vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? vehicles[0] ?? null;
  const motion = selectedVehicle ? layout?.vehicles.find((vehicle) => vehicle.id === selectedVehicle.id) : undefined;
  const startSpeed = scene && motion ? getStartingSpeed(motion.poseAt, scene.startTime, selectedVehicle?.visibleFrom, selectedVehicle?.visibleTo) : null;

  const v0 = startSpeed;
  const t = parseNumber(time);
  const canCalculate = v0 !== null && t !== null;
  const position = canCalculate ? v0 * t + 0.5 * CONSTANT_ACCELERATION_MPS2 * t * t : null;
  const velocity = canCalculate ? v0 + CONSTANT_ACCELERATION_MPS2 * t : null;

  if (!open) {
    return (
      <button
        type="button"
        aria-label="Show kinematics calculator"
        onClick={() => setOpen(true)}
        className="absolute top-4 right-4 z-30 flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-lg"
      >
        <Calculator size={16} className="text-[#1a73e8]" />
        Kinematics
      </button>
    );
  }

  return (
    <aside
      aria-label="Kinematics calculator"
      className="absolute top-4 right-4 bottom-24 z-30 flex w-[300px] max-w-[calc(100vw-2rem)] flex-col overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_28px_rgba(0,0,0,0.2)]"
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Calculator size={17} className="text-[#1a73e8]" />
            Kinematics
          </div>
          <p className="mt-1 text-xs text-slate-500">1D motion at constant acceleration</p>
        </div>
        <button
          type="button"
          aria-label="Hide kinematics calculator"
          onClick={() => setOpen(false)}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
        >
          <X size={16} />
        </button>
      </header>

      <section aria-label="Initial conditions" className="space-y-3">
        {selectedVehicle && scene && (
          <>
            <label htmlFor="kinematics-vehicle" className="flex flex-col gap-1 text-[11px] font-medium text-slate-600">
              Vehicle
              <select
                id="kinematics-vehicle"
                value={selectedVehicle.id}
                onChange={(event) => setSelectedVehicleId(event.currentTarget.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-900 outline-none focus:border-[#1a73e8]"
              >
                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>{vehicle.label}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <ReadOnlyField
          label="Initial velocity (v₀)"
          unit="m/s"
          value={startSpeed === null ? "Unavailable" : formatNumber(startSpeed)}
        />
        <ReadOnlyField
          label="Constant acceleration (a)"
          unit="m/s²"
          value={formatNumber(CONSTANT_ACCELERATION_MPS2)}
        />
        <NumberField id="kinematics-time" label="Evaluate at time (t)" unit="s" value={time} onChange={setTime} />
      </section>

      <div className="mt-4 rounded-xl bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600">
        <div>x(t) = v₀t + ½at²</div>
        <div>v(t) = v₀ + at</div>
        <div>a(t) = a</div>
      </div>

      <section aria-label="Calculated motion" aria-live="polite" className="mt-4">
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">At t = {time || "—"} s</h2>
        <dl className="space-y-2">
          <Result label="Position from start" value={position} unit="m" />
          <Result label="Velocity" value={velocity} unit="m/s" />
          <Result label="Acceleration" value={CONSTANT_ACCELERATION_MPS2} unit="m/s²" />
        </dl>
        {startSpeed === null ? (
          <p className="mt-3 text-xs text-amber-700">Vehicle speed is unavailable for this scene.</p>
        ) : t === null ? (
          <p className="mt-3 text-xs text-amber-700">Enter a valid time.</p>
        ) : null}
      </section>

      <p className="mt-auto pt-4 text-[11px] leading-relaxed text-slate-400">
        Motion values are fixed for the reconstruction. Initial velocity uses the selected collision vehicle’s start speed; only evaluation time is editable.
      </p>
    </aside>
  );
}

function getStartingSpeed(
  poseAt: (time: number) => { x: number; z: number; hidden?: boolean },
  startTime: number,
  visibleFrom?: number,
  visibleTo?: number,
) {
  const sampleStep = 0.01;
  // A vehicle that hasn't driven in yet (or already left) is parked off the road: measure from the
  // moment it is on screen instead of reading its held pose as "stopped".
  let from = startTime;
  if (poseAt(from).hidden) {
    if (visibleFrom != null && visibleFrom > from) from = visibleFrom;
    else if (visibleTo != null && visibleTo < from) from = visibleTo - sampleStep;
    else return null;
  }
  const start = poseAt(from);
  let to = from + sampleStep;
  // Right at its exit: difference backwards.
  if (poseAt(to).hidden) to = from - sampleStep;
  const next = poseAt(to);
  return Math.hypot(next.x - start.x, next.z - start.z) / sampleStep;
}

function Result({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-slate-900">
        {value === null ? "—" : `${formatNumber(value)} ${unit}`}
      </dd>
    </div>
  );
}
