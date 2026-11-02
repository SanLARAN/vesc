import { encodeVescFrame, VescPacketAssembler } from './vescProtocol';

/**
 * Standard BLE UART Services used by Flipsky 75100 Pro V2 built-in BLE,
 * official VESC nRF51/nRF52/ESP32 Express modules, and external HM-10 / JDY UART bridges.
 */
export const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const NUS_RX_WRITE_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const NUS_TX_NOTIFY_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

export const HM10_SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
export const HM10_CHAR_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb';

export const FFF0_SERVICE_UUID = '0000fff0-0000-1000-8000-00805f9b34fb';

export const OPTIONAL_BLE_SERVICES = [
  NUS_SERVICE_UUID,
  HM10_SERVICE_UUID,
  FFF0_SERVICE_UUID,
];

// Minimal ambient interfaces so strict TS works cleanly in all browsers
interface BleCharacteristic {
  uuid: string;
  properties: {
    write: boolean;
    writeWithoutResponse: boolean;
    notify: boolean;
    indicate: boolean;
  };
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

export interface VescTransport {
  readonly deviceName: string;
  readonly kind: 'ble' | 'usb';
  sendPayload(payload: Uint8Array): Promise<void>;
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
    (typeof navigator !== 'undefined' &&
      navigator.platform === 'MacIntel' &&
      navigator.maxTouchPoints > 1);
  const hasWebBluetooth =
    typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  const hasWebSerial =
    typeof navigator !== 'undefined' && 'serial' in navigator;
  const isSecureContext =
    typeof window !== 'undefined' ? window.isSecureContext : true;

  return { hasWebBluetooth, hasWebSerial, isIOS, isSecureContext };
}

/**
 * Connects to a Flipsky 75100 Pro V2 / VESC over Web Bluetooth GATT.
 * Handles 20-byte BLE ATT MTU chunking automatically and serializes GATT writes.
 */
export async function connectBleVesc(
  callbacks: VescTransportCallbacks,
  filterOnlyNus = false
): Promise<VescTransport> {
  const nav = navigator as unknown as {
    bluetooth?: {
      requestDevice(opts: unknown): Promise<BleDevice>;
    };
  };

  if (!nav.bluetooth) {
    throw new Error(
      'Web Bluetooth недоступен в этом браузере. На Android откройте в Chrome, на iPhone — в браузере Bluefy.'
    );
  }

  const requestOptions = filterOnlyNus
    ? {
        filters: [
          { services: [NUS_SERVICE_UUID] },
          { services: [HM10_SERVICE_UUID] },
          { namePrefix: 'VESC' },
          { namePrefix: 'Flipsky' },
          { namePrefix: 'FSESC' },
          { namePrefix: 'BLE' },
        ],
        optionalServices: OPTIONAL_BLE_SERVICES,
      }
    : {
        acceptAllDevices: true,
        optionalServices: OPTIONAL_BLE_SERVICES,
      };

  callbacks.onLog?.('Запрос Bluetooth-устройства...');
  const device = await nav.bluetooth.requestDevice(requestOptions);
  const label = device.name || `VESC (${device.id.slice(0, 6)})`;

  if (!device.gatt) {
    throw new Error(`Устройство ${label} не поддерживает BLE GATT.`);
  }

  callbacks.onLog?.(`Подключение к GATT серверу ${label}...`);
  const server = await device.gatt.connect();
  const services = await server.getPrimaryServices();

  let writeChar: BleCharacteristic | null = null;
  let notifyChar: BleCharacteristic | null = null;

  for (const svc of services) {
    const chars = await svc.getCharacteristics();
    for (const ch of chars) {
      const uuid = ch.uuid.toLowerCase();
      if (uuid === NUS_RX_WRITE_UUID) {
        writeChar = ch;
      } else if (uuid === NUS_TX_NOTIFY_UUID) {
        notifyChar = ch;
      } else {
        if (!writeChar && (ch.properties.writeWithoutResponse || ch.properties.write)) {
          writeChar = ch;
        }
        if (!notifyChar && (ch.properties.notify || ch.properties.indicate)) {
          notifyChar = ch;
        }
      }
    }
  }

  if (!writeChar || !notifyChar) {
    server.disconnect();
    throw new Error(
      `На устройстве «${label}» не найден сервис VESC BLE UART (NUS 6e400001 / FFE0). Убедитесь, что выбрали именно контроллер VESC.`
    );
  }

  const assembler = new VescPacketAssembler();
  const handleNotification = (ev: Event) => {
    const target = ev.target as unknown as BleCharacteristic;
    if (!target.value) return;
    const chunk = new Uint8Array(
      target.value.buffer,
      target.value.byteOffset,
      target.value.byteLength
    );
    const payloads = assembler.push(chunk);
    for (const p of payloads) {
      callbacks.onPayload(p);
    }
  };

  notifyChar.addEventListener('characteristicvaluechanged', handleNotification);
  await notifyChar.startNotifications();

  const handleDisconnected = () => {
    assembler.reset();
    callbacks.onLog?.(`Bluetooth ${label} отключён.`);
    callbacks.onDisconnect();
  };
  device.addEventListener('gattserverdisconnected', handleDisconnected);

  callbacks.onLog?.(
    `Подключено к ${label} (TX: ${writeChar.uuid.slice(4, 8)}, RX: ${notifyChar.uuid.slice(4, 8)})`
  );

  // Serialize GATT writes so concurrent telemetry + throttle ticks never collide
  let writeChain = Promise.resolve();
  const BLE_CHUNK_SIZE = 20;

  const txChar = writeChar;
  const rxChar = notifyChar;

  return {
    deviceName: label,
    kind: 'ble',
    isConnected: () => Boolean(device.gatt?.connected),
    async sendPayload(payload: Uint8Array) {
      const frame = encodeVescFrame(payload);
      writeChain = writeChain
        .then(async () => {
          if (!device.gatt?.connected) return;
          for (let i = 0; i < frame.length; i += BLE_CHUNK_SIZE) {
            const slice = frame.slice(i, i + BLE_CHUNK_SIZE);
            if (
              txChar.properties.writeWithoutResponse &&
              typeof txChar.writeValueWithoutResponse === 'function'
            ) {
              await txChar.writeValueWithoutResponse(slice);
            } else if (typeof txChar.writeValueWithResponse === 'function') {
              await txChar.writeValueWithResponse(slice);
            } else {
              await txChar.writeValue(slice);
            }
          }
        })
        .catch(() => {
          // Transient GATT busy error should not break future writes
        });
      return writeChain;
    },
    async disconnect() {
      device.removeEventListener('gattserverdisconnected', handleDisconnected);
      rxChar.removeEventListener('characteristicvaluechanged', handleNotification);
      try {
        if (device.gatt?.connected) {
          await rxChar.stopNotifications().catch(() => {});
          device.gatt.disconnect();
        }
      } finally {
        assembler.reset();
      }
    },
  };
}

/**
 * Optional USB-C Desktop/Android OTG connection via Web Serial API (115200 8N1).
 */
export async function connectUsbSerialVesc(
  callbacks: VescTransportCallbacks
): Promise<VescTransport> {
  const nav = navigator as unknown as {
    serial?: {
      requestPort(): Promise<{
        open(opts: { baudRate: number }): Promise<void>;
        close(): Promise<void>;
        readable: ReadableStream<Uint8Array> | null;
        writable: WritableStream<Uint8Array> | null;
      }>;
    };
  };

  if (!nav.serial) {
    throw new Error('Web Serial USB поддерживается только в Chrome / Edge на ПК.');
  }

  const port = await nav.serial.requestPort();
  await port.open({ baudRate: 115200 });

  const assembler = new VescPacketAssembler();
  let connected = true;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  (async () => {
    try {
      while (port.readable && connected) {
        reader = port.readable.getReader();
        try {
          while (connected) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) {
              for (const p of assembler.push(value)) {
                callbacks.onPayload(p);
              }
            }
          }
        } finally {
          reader.releaseLock();
          reader = null;
        }
      }
    } catch {
      // Port closed/unplugged
    } finally {
      if (connected) {
        connected = false;
        callbacks.onDisconnect();
      }
    }
  })();

  let writeChain = Promise.resolve();
  callbacks.onLog?.('Подключено к VESC по USB-C (115200 бод).');

  return {
    deviceName: 'VESC USB-C (115200)',
    kind: 'usb',
    isConnected: () => connected,
    async sendPayload(payload: Uint8Array) {
      const frame = encodeVescFrame(payload);
      writeChain = writeChain
        .then(async () => {
          if (!connected || !port.writable) return;
          const writer = port.writable.getWriter();
          try {
            await writer.write(frame);
          } finally {
            writer.releaseLock();
          }
        })
        .catch(() => {});
      return writeChain;
    },
    async disconnect() {
      connected = false;
      try {
        await reader?.cancel().catch(() => {});
        await port.close().catch(() => {});
      } finally {
        assembler.reset();
      }
    },
  };
}
