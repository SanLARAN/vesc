import { useState } from 'react';
import { CircleDot, Download, Eye, MapPin, Square, Trash2 } from 'lucide-react';
import type { GeoFix } from '../hooks/useGeolocation';
import { exportGpx, RouteRecorderApi, SpeedThresholdSet } from '../hooks/useRouteRecorder';
import { RouteMap } from './RouteMap';
import { Card, fmt, fmtTime, NumberField, Notice, Sheet, Stat } from './ui';

interface Props {
  recorder: RouteRecorderApi;
  fix: GeoFix | null;
  gpsIssue: string | null;
}

const fmtDate = (at: number) =>
  new Date(at).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export function TripsView({ recorder, fix, gpsIssue }: Props) {
  const r = recorder;
  const a = r.analytics;
  const [editColors, setEditColors] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const elapsed = r.points.length > 1 ? (r.points[r.points.length - 1].at - r.points[0].at) / 1000 : 0;
  const viewing = r.viewingTripId ? r.trips.find((t) => t.id === r.viewingTripId) : null;
  const t = r.thresholds;
  const bands = [`< ${t[0]}`, `${t[0]}–${t[1]}`, `${t[1]}–${t[2]}`, `> ${t[2]}`];

  return (
    <div className="flex flex-col gap-3">
      <RouteMap
        points={r.points}
        fix={fix}
        colors={r.colors}
        thresholds={r.thresholds}
        follow={!viewing}
        fitKey={r.viewingTripId}
        className="h-[46vh] min-h-[280px]"
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {bands.map((b, i) => (
          <span key={b} className="chip">
            <span className="h-2 w-2" style={{ background: r.colors[i] }} />
            <span className="num">{b}</span>
          </span>
        ))}
        <button type="button" className="chip" onClick={() => setEditColors(true)}>
          Настроить
        </button>
        <span className="ml-auto text-[11px] text-[var(--fg-faint)]">Тап по карте — маршрут</span>
      </div>

      {(gpsIssue || r.storageIssue) && <Notice tone="warn">{gpsIssue ?? r.storageIssue}</Notice>}

      <Card
        title={viewing ? `Поездка ${fmtDate(viewing.startedAt)}` : r.recording ? 'Запись трека' : 'Трек'}
        icon={<MapPin size={13} />}
        right={
          r.recording ? (
            <span className="chip chip-bad">
              <span className="pulse-bad h-2 w-2 bg-[var(--bad)]" /> REC
            </span>
          ) : fix ? (
            <span className="chip chip-good num">GPS ±{Math.round(fix.accuracy)} м</span>
          ) : (
            <span className="chip">GPS ожидание</span>
          )
        }
      >
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Путь" value={fmt(a.distanceMeters / 1000, 2)} unit="км" tone="accent" />
          <Stat label="Время" value={fmtTime(elapsed)} />
          <Stat label="Средняя" value={fmt(a.averageSpeedKmh, 1)} unit="км/ч" />
          <Stat label="Макс." value={fmt(a.maxSpeedKmh, 1)} unit="км/ч" size="sm" />
          <Stat label="Энергия" value={fmt(a.energyWh)} unit="Вт·ч" size="sm" />
          <Stat label="Расход" value={fmt(a.consumptionWhPerKm)} unit="Вт·ч/км" size="sm" />
        </div>
        <div className="mt-4 grid grid-cols-[1fr_auto_auto] gap-2">
          {r.recording ? (
            <button type="button" className="btn btn-danger" onClick={r.stop}>
              <Square size={15} /> Стоп и сохранить
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={r.start}>
              <CircleDot size={15} /> {viewing ? 'Новая запись' : 'Начать запись'}
            </button>
          )}
          <button
            type="button"
            className="btn"
            disabled={r.points.length < 2}
            onClick={() => exportGpx(r.points, r.points[0]?.at)}
            aria-label="Скачать GPX"
          >
            <Download size={15} /> GPX
          </button>
          <button type="button" className="btn btn-ghost" disabled={r.points.length === 0} onClick={r.clear} aria-label="Очистить трек">
            <Trash2 size={15} />
          </button>
        </div>
      </Card>

      <Card
        title="История поездок"
        right={
          r.trips.length > 0 ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(true)}>
              Очистить
            </button>
          ) : undefined
        }
      >
        {r.trips.length === 0 ? (
          <div className="py-4 text-center text-[13px] text-[var(--fg-muted)]">Сохранённых поездок пока нет. Запишите трек — он появится здесь.</div>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--line)]">
            {r.trips.map((trip) => {
              const dur = (trip.endedAt - trip.startedAt) / 1000;
              const active = trip.id === r.viewingTripId;
              return (
                <li key={trip.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold" style={active ? { color: 'rgb(var(--accent-rgb))' } : undefined}>
                      {fmtDate(trip.startedAt)}
                    </div>
                    <div className="num mt-0.5 text-[12px] text-[var(--fg-muted)]">
                      {(trip.distanceMeters / 1000).toFixed(2)} км · {fmtTime(dur)} · ср {trip.averageSpeedKmh.toFixed(0)} · макс {trip.maxSpeedKmh.toFixed(0)} км/ч
                      {trip.consumptionWhPerKm !== null ? ` · ${trip.consumptionWhPerKm.toFixed(0)} Вт·ч/км` : ''}
                    </div>
                  </div>
                  <button type="button" className="icon-btn h-9 w-9" aria-label="Показать на карте" onClick={() => r.showTrip(trip)}>
                    <Eye size={16} />
                  </button>
                  <button type="button" className="icon-btn h-9 w-9" aria-label="Скачать GPX" onClick={() => exportGpx(trip.points, trip.startedAt)}>
                    <Download size={16} />
                  </button>
                  <button type="button" className="icon-btn h-9 w-9" aria-label="Удалить" onClick={() => r.deleteTrip(trip.id)}>
                    <Trash2 size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Sheet open={editColors} onClose={() => setEditColors(false)} title="Цвета трека по скорости">
        <div className="flex flex-col gap-3">
          {r.colors.map((c, i) => (
            <div key={i} className="flex items-center gap-3">
              <input
                type="color"
                value={c}
                aria-label={`Цвет ${bands[i]}`}
                className="h-11 w-14 cursor-pointer border border-[var(--line-strong)] bg-transparent"
                onChange={(e) => {
                  const next = [...r.colors] as typeof r.colors;
                  next[i] = e.target.value;
                  r.setColors(next);
                }}
              />
              <span className="num w-24 text-[13px] font-semibold">{bands[i]} км/ч</span>
              {i < 3 && (
                <NumberField
                  label={`Порог ${i + 1}`}
                  value={t[i]}
                  min={i === 0 ? 1 : t[i - 1] + 1}
                  max={i === 2 ? 200 : t[i + 1] - 1}
                  unit="км/ч"
                  onCommit={(v) => {
                    const next = [...t] as SpeedThresholdSet;
                    next[i] = v;
                    if (next[0] < next[1] && next[1] < next[2]) r.setThresholds(next);
                  }}
                  className="flex-1"
                />
              )}
            </div>
          ))}
        </div>
      </Sheet>

      <Sheet
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Удалить всю историю поездок?"
        footer={
          <>
            <button
              type="button"
              className="btn btn-danger flex-1"
              onClick={() => {
                r.clearHistory();
                setConfirmClear(false);
              }}
            >
              Удалить
            </button>
            <button type="button" className="btn flex-1" onClick={() => setConfirmClear(false)}>
              Отмена
            </button>
          </>
        }
      >
        <p className="text-[13.5px] text-[var(--fg-muted)]">Сохранённые треки будут удалены с этого устройства. Перед удалением можно скачать их в GPX.</p>
      </Sheet>
    </div>
  );
}
