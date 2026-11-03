import { encodeVescFrame, VescPacketAssembler } from './vescProtocol';

/**
 * BLE UART services used by VESC BLE modules (nRF51/nRF52, VESC Express),
 * Flipsky built-in BLE and HM-10 / JDY bridges.
 */
export const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const NUS_RX_WRITE_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const NUS_TX_NOTIFY_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
export const HM10_SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
export const FFF0_SERVICE_UUID = '0000fff0-0000-1000-8000-00805f9b34fb';

const SERVICE_PRIORITY = [NUS_SERVICE_UUID, HM10_SERVICE_UUID, FFF0_SERVICE_UUID];

interface BleCharacteristic {
  uuid: string;
  properties: { write: boolean; writeWithoutResponse: boolean; notify: boolean; indicate: boolean };
  value?: DataView;
  startNotifications(): Promise<BleCharacteristic>;
  stopNotifications(): Promise<BleCharacteristic>;
  writeValueWithoutResponse?(data: BufferSource): Promise<void>;
  writeValueWithResponse?(data: BufferSource): Promise<void>;
  writeValue(data: BufferSource): Promise<void>;
  addEventListener(type: string, listener: (ev: Event) => void): void;
  removeEventListener(type: string, listener: (ev: Event) => void): void;
}

interface BleService {
  uuid: string;
  getCharacteristics(): Promise<BleCharacteristic[]>;
}

interface BleGattServer {
  connected: boolean;
  connect(): Promise<BleGattServer>;
  disconnect(): void;
  getPrimaryServices(): Promise<BleService[]>;
}

interface BleDevice {
  id: string;
  name?: string;
  gatt?: BleGattServer;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface VescTransportCallbacks {
  onPayload: (payload: Uint8Array) => void;
  onDisconnect: () => void;
  onLog?: (msg: string) => void;
}

export interface SendOptions {
  /** Use acknowledged BLE writes (slower, but flow-controlled) — for configuration packets. */
  reliable?: boolean;
}

export interface VescTransport {
  readonly deviceName: string;
  readonly kind: 'ble' | 'usb' | 'sim';
  /** Resolves when the frame was handed to the link; rejects on link errors. */
  sendPayload(payload: Uint8Array, options?: SendOptions): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}

export function detectBrowserSupport(): {
  hasWebBluetooth: boolean;
  hasWebSerial: boolean;
  isIOS: boolean;
  isSecureContext: boolean;
} {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return {
    hasWebBluetooth: typeof navigator !== 'undefined' && 'bluetooth' in navigator,
    hasWebSerial: typeof navigator !== 'undefined' && 'serial' in navigator,
    isIOS,
    isSecureContext: typeof window !== 'undefined' ? window.isSecureContext : true,
  };
}

/** Serialises writes; a failed write rejects its own promise but never blocks the next one. */
function createWriteQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T,>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job, job);
    tail = run.catch(() => undefined);
    return run;
  };
}

async function pickUartCharacteristics(
  services: BleService[]
): Promise<{ write: BleCharacteristic; notify: BleCharacteristic; service: string } | null> {
  const ordered = [...services].sort((a, b) => {
    const ia = SERVICE_PRIORITY.indexOf(a.uuid.toLowerCase());
    const ib = SERVICE_PRIORITY.indexOf(b.uuid.toLowerCase());
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  for (const svc of ordered) {
    let chars: BleCharacteristic[] = [];
    try {
      chars = await svc.getCharacteristics();
    } catch {
      continue;
    }
    const byUuid = (u: string) => chars.find((c) => c.uuid.toLowerCase() === u);
    const nusWrite = byUuid(NUS_RX_WRITE_UUID);
    const nusNotify = byUuid(NUS_TX_NOTIFY_UUID);
    if (nusWrite && nusNotify) return { write: nusWrite, notify: nusNotify, service: svc.uuid };
    // Write + notify must come from the SAME service, otherwise we would talk to two different peripherals.
    const write = chars.find((c) => c.properties.writeWithoutResponse || c.properties.write);
    const notify = chars.find((c) => c.properties.notify || c.properties.indicate);
    if (write && notify && SERVICE_PRIORITY.includes(svc.uuid.toLowerCase())) {
      return { write, notify, service: svc.uuid };
    }
  }
  return null;
}

export async function connectBleVesc(callbacks: VescTransportCallbacks, filterOnlyVesc = false): Promise<VescTransport> {
  const nav = navigator as unknown as { bluetooth?: { requestDevice(opts: unknown): Promise<BleDevice> } };
  if (!nav.bluetooth) {
    throw new Error('Web Bluetooth недоступен. На Android откройте страницу в Chrome, на iPhone — в браузере Bluefy.');
  }

  const requestOptions = filterOnlyVesc
    ? {
        filters: [
          { services: [NUS_SERVICE_UUID] },
          { services: [HM10_SERVICE_UUID] },
          { namePrefix: 'VESC' },
          { namePrefix: 'Flipsky' },
          { namePrefix: 'FSESC' },
        ],
        optionalServices: SERVICE_PRIORITY,
      }
    : { acceptAllDevices: true, optionalServices: SERVICE_PRIORITY };

  callbacks.onLog?.('Запрос Bluetooth-устройства…');
  const device = await nav.bluetooth.requestDevice(requestOptions);
  const label = device.name || `VESC ${device.id.slice(0, 6)}`;
  if (!device.gatt) throw new Error(`Устройство ${label} не поддерживает BLE GATT.`);

  callbacks.onLog?.(`Подключение к ${label}…`);
  const server = await device.gatt.connect();
  const picked = await pickUartCharacteristics(await server.getPrimaryServices());
  if (!picked) {
    server.disconnect();
    throw new Error(`На «${label}» нет UART-сервиса VESC (NUS 6e400001 / FFE0 / FFF0). Выберите модуль Bluetooth контроллера.`);
  }
  const { write: txChar, notify: rxChar } = picked;

  const assembler = new VescPacketAssembler();
  const handleNotification = (ev: Event) => {
    const target = ev.target as unknown as BleCharacteristic;
    if (!target.value) return;
    const chunk = new Uint8Array(target.value.buffer, target.value.byteOffset, target.value.byteLength);
    for (const p of assembler.push(chunk)) callbacks.onPayload(p);
  };
  rxChar.addEventListener('characteristicvaluechanged', handleNotification);
  await rxChar.startNotifications();

  let closedByUser = false;
  const handleDisconnected = () => {
    assembler.reset();
    if (!closedByUser) {
      callbacks.onLog?.(`Bluetooth «${label}» потерян.`);
      callbacks.onDisconnect();
    }
  };
  device.addEventListener('gattserverdisconnected', handleDisconnected);
  callbacks.onLog?.(`Подключено: ${label} (сервис ${picked.service.slice(4, 8)})`);

  const enqueue = createWriteQueue();
  const CHUNK = 20;

  return {
    deviceName: label,
    kind: 'ble',
    isConnected: () => Boolean(device.gatt?.connected),
    sendPayload(payload, options) {
      const frame = encodeVescFrame(payload);
      return enqueue(async () => {
        if (!device.gatt?.connected) throw new Error('Bluetooth не подключён');
        for (let i = 0; i < frame.length; i += CHUNK) {
          const slice = frame.slice(i, i + CHUNK);
          const canAck = txChar.properties.write && typeof txChar.writeValueWithResponse === 'function';
          const canFast = txChar.properties.writeWithoutResponse && typeof txChar.writeValueWithoutResponse === 'function';
          if ((options?.reliable || !canFast) && canAck) await txChar.writeValueWithResponse!(slice);
          else if (canFast) await txChar.writeValueWithoutResponse!(slice);
          else await txChar.writeValue(slice);
        }
      });
    },
    async disconnect() {
      closedByUser = true;
      device.removeEventListener('gattserverdisconnected', handleDisconnected);
      rxChar.removeEventListener('characteristicvaluechanged', handleNotification);
      try {
        if (device.gatt?.connected) {
          await rxChar.stopNotifications().catch(() => undefined);
          device.gatt.disconnect();
        }
      } finally {
        assembler.reset();
      }
    },
  };
}

interface SerialPortLike {
  open(opts: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

/** USB-C (Web Serial, desktop Chrome/Edge). */
export async function connectUsbSerialVesc(callbacks: VescTransportCallbacks): Promise<VescTransport> {
  const nav = navigator as unknown as { serial?: { requestPort(): Promise<SerialPortLike> } };
  if (!nav.serial) throw new Error('Web Serial (USB) работает только в Chrome / Edge на компьютере.');

  const port = await nav.serial.requestPort();
  await port.open({ baudRate: 115200 });

  const assembler = new VescPacketAssembler();
  let connected = true;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const readLoop = (async () => {
    try {
      while (port.readable && connected) {
        reader = port.readable.getReader();
        try {
          while (connected) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) for (const p of assembler.push(value)) callbacks.onPayload(p);
          }
        } finally {
          reader.releaseLock();
          reader = null;
        }
      }
    } catch {
      // Cable unplugged or port closed.
    } finally {
      if (connected) {
        connected = false;
        callbacks.onDisconnect();
      }
    }
  })();

  const enqueue = createWriteQueue();
  callbacks.onLog?.('Подключено к VESC по USB (115200 бод).');

  return {
    deviceName: 'VESC USB',
    kind: 'usb',
    isConnected: () => connected,
    sendPayload(payload) {
      const frame = encodeVescFrame(payload);
      return enqueue(async () => {
        if (!connected || !port.writable) throw new Error('USB не подключён');
        const writer = port.writable.getWriter();
        try {
          await writer.write(frame);
        } finally {
          writer.releaseLock();
        }
      });
    },
    async disconnect() {
      connected = false;
      try {
        await (reader as ReadableStreamDefaultReader<Uint8Array> | null)?.cancel().catch(() => undefined);
        // The read loop must release its lock before the port can be closed.
        await readLoop;
        await port.close().catch(() => undefined);
      } finally {
        assembler.reset();
      }
    },
  };
}
