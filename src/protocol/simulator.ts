import { faultCodeToRu, VescTelemetry } from './vescProtocol';

export interface SimMotorState {
  erpm: number;
  duty: number;
  motorCurrent: number;
  inputCurrent: number;
  idCurrent: number; // Field weakening d-axis current (up to -10A above 0.90 duty)
  tempFet: number;
  tempMotor: number;
  tachometer: number;
  tachometerAbs: number;
}

/**
 * Physics model calibrated specifically for Dualtron Achilleus 60V (16S Li-Ion, BMS 100A, 47A x 2 = 94A)
 * on 2x Flipsky 75100 Pro V2:
 * - Master (ID 0): Front Motor (Hall Sensors + ADC Throttle + BLE)
 * - Slave  (ID 1): Rear Motor  (Sensorless / HFI over CAN 500K)
 * - Supports Field Weakening (10A @ 0.90 duty -> boosts top speed from ~80 km/h to ~93 km/h!)
 */
export class DualFlipskySimulator {
  private packRestVoltage = 66.4; // 16S Achilleus pack charged
  private ampHours = 1.62;
  private ampHoursCharged = 0.22;
  private wattHours = 101.5;
  private wattHoursCharged = 13.4;
  private faultCode = 0;
  private demoPhaseTime = 0;

  // ID 0: Master — Front Motor (Hall Sensors)
  private frontMaster: SimMotorState = {
    erpm: 0,
    duty: 0,
    motorCurrent: 0,
    inputCurrent: 0,
    idCurrent: 0,
    tempFet: 34.6,
    tempMotor: 36.8,
    tachometer: 0,
    tachometerAbs: 0,
  };

  // ID 1: Slave — Rear Motor (Sensorless)
  private rearSlave: SimMotorState = {
    erpm: 0,
    duty: 0,
    motorCurrent: 0,
    inputCurrent: 0,
    idCurrent: 0,
    tempFet: 36.2,
    tempMotor: 39.4,
    tachometer: 0,
    tachometerAbs: 0,
  };

  setSimulatedFault(code: number): void {
    this.faultCode = code;
  }

  getRestVoltage(): number {
    return this.packRestVoltage;
  }

  step(
    dt: number,
    manualFront: number,
    manualRear: number,
    brakingFront: boolean,
    brakingRear: boolean,
    autoCruiseDemo: boolean,
    parkingHold: boolean,
    fieldWeakeningOn: boolean,
    frontPhaseMaxAmps: number,
    rearPhaseMaxAmps: number,
    maxBrakeAmps: number,
    profileMaxErpm: number,
    profileMaxWatts: number,
    perEscBatteryAmpsCap: number // 30A -> 35A -> 40A -> 45A -> 47A per ESC!
  ): { frontMaster: VescTelemetry; rearSlave: VescTelemetry } {
    // Base no-FW top ERPM on 60V Achilleus 11" = ~24,000 ERPM (~80.4 km/h)
    // With Field Weakening 10A (@ 0.90 duty) = ~28,000 ERPM (~93.8 km/h)!
    const baseKvMaxErpm = 24000;
    const fwBoostedMaxErpm = fieldWeakeningOn ? 28000 : baseKvMaxErpm;
    const effectiveErpmCeiling = Math.min(
      40000,
      Math.min(fwBoostedMaxErpm, Math.max(1500, profileMaxErpm))
    );

    let cmdFront = manualFront;
    let cmdRear = manualRear;
    let isBrakingF = brakingFront;
    let isBrakingR = brakingRear;

    if (parkingHold) {
      cmdFront = 0;
      cmdRear = 0;
      isBrakingF = true;
      isBrakingR = true;
    } else if (
      autoCruiseDemo &&
      Math.abs(manualFront) < 0.01 &&
      Math.abs(manualRear) < 0.01 &&
      !brakingFront &&
      !brakingRear
    ) {
      this.demoPhaseTime = (this.demoPhaseTime + dt) % 21;
      const t = this.demoPhaseTime;
      if (t < 2.0) {
        // Standstill at start line
        cmdFront = 0;
        cmdRear = 0;
        isBrakingF = true;
        isBrakingR = true;
      } else if (t < 9.5) {
        // Full pull through ECO -> NORMAL -> TURBO + Field Weakening above 0.90 duty!
        cmdFront = frontPhaseMaxAmps > 1 ? 1.0 : 0;
        cmdRear = rearPhaseMaxAmps > 1 ? 1.0 : 0;
      } else if (t < 15.0) {
        // High-speed cruise
        const wave = 0.86 + Math.sin(t * 1.4) * 0.1;
        cmdFront = frontPhaseMaxAmps > 1 ? wave : 0;
        cmdRear = rearPhaseMaxAmps > 1 ? wave : 0;
      } else if (t < 19.0) {
        // Strong -60A E-ABS regenerative braking
        cmdFront = 0.8;
        cmdRear = 0.85;
        isBrakingF = true;
        isBrakingR = true;
      } else {
        cmdFront = 0;
        cmdRear = 0;
      }
    }

    const coupledErpm = (this.frontMaster.erpm + this.rearSlave.erpm) / 2;

    const computePhase = (
      m: SimMotorState,
      cmd: number,
      braking: boolean,
      maxPhaseA: number,
      isSensorlessRear: boolean
    ): number => {
      if (this.faultCode !== 0) return 0;
      if (parkingHold) {
        if (Math.abs(m.erpm) < 30) {
          m.erpm = 0;
          return 0;
        }
        return -Math.sign(m.erpm) * 18;
      }
      if (braking) {
        const brakeStrength = Math.min(1, Math.abs(cmd));
        const speedRatio = Math.min(1, Math.abs(m.erpm) / 3000);
        return -Math.sign(m.erpm || 1) * brakeStrength * maxBrakeAmps * speedRatio;
      }
      if (Math.abs(cmd) > 0.005 && maxPhaseA > 1) {
        // Rear sensorless openloop ramp (15-20A below 600 ERPM per section 18.5!)
        const effectivePhaseCap =
          isSensorlessRear && Math.abs(coupledErpm) < 650
            ? Math.min(maxPhaseA, 20)
            : maxPhaseA;
        const speedRatio = Math.abs(m.erpm) / fwBoostedMaxErpm;
        const targetRatio = Math.min(1, Math.abs(cmd));
        const torqueDemand = Math.max(-1, Math.min(1, (targetRatio - speedRatio) * 5.0));
        return Math.sign(cmd) * Math.max(0, torqueDemand) * effectivePhaseCap;
      }
      return m.motorCurrent * Math.exp(-12 * dt);
    };

    let iFront = computePhase(this.frontMaster, cmdFront, isBrakingF, frontPhaseMaxAmps, false);
    let iRear = computePhase(this.rearSlave, cmdRear, isBrakingR, rearPhaseMaxAmps, true);

    // Per-ESC Battery Current Max clamping (30A -> 35A -> 40A -> 45A -> 47A per ESC)
    const clampBattCurrent = (iPhase: number, erpm: number) => {
      const dutyEst = Math.max(0.18, Math.min(0.95, Math.abs(erpm) / baseKvMaxErpm));
      const battEst = iPhase * dutyEst;
      if (battEst > perEscBatteryAmpsCap && battEst > 0.1) {
        return iPhase * (perEscBatteryAmpsCap / battEst);
      }
      return iPhase;
    };

    iFront = clampBattCurrent(iFront, this.frontMaster.erpm);
    iRear = clampBattCurrent(iRear, this.rearSlave.erpm);

    // Total system Watt cap
    const totalEstDuty = Math.max(0.18, Math.min(0.95, Math.abs(coupledErpm) / baseKvMaxErpm));
    const estTotalWatts = (iFront + iRear) * totalEstDuty * (this.packRestVoltage - 2.5);
    if (estTotalWatts > profileMaxWatts && estTotalWatts > 10) {
      const wScale = profileMaxWatts / estTotalWatts;
      iFront *= wScale;
      iRear *= wScale;
    }

    const totalDriveForce = iFront + iRear;
    const speedNorm = coupledErpm / baseKvMaxErpm;
    const aeroDrag = Math.sign(coupledErpm) * (5.0 + 43 * speedNorm * speedNorm);
    const netAccel =
      Math.abs(coupledErpm) < 25 && Math.abs(totalDriveForce) < 2
        ? 0
        : totalDriveForce - aeroDrag;

    let nextErpm = coupledErpm + netAccel * 145 * dt;
    if (
      (isBrakingF || isBrakingR || Math.abs(totalDriveForce) < 0.5) &&
      Math.abs(nextErpm) < 35
    ) {
      nextErpm = 0;
    }
    nextErpm = Math.max(-effectiveErpmCeiling, Math.min(effectiveErpmCeiling, nextErpm));

    const finalize = (m: SimMotorState, phaseAmps: number) => {
      m.motorCurrent = Math.abs(phaseAmps) < 0.05 ? 0 : phaseAmps;
      m.erpm = nextErpm;
      const rawDuty = m.erpm / baseKvMaxErpm;
      m.duty = Math.max(-0.95, Math.min(0.95, rawDuty));

      // Section 21.2 Field Weakening: Duty Start = 0.90, FW Current Max = 10A, Ramp = 0.2s
      let targetFwId = 0;
      if (fieldWeakeningOn && Math.abs(m.duty) >= 0.9 && phaseAmps > 2) {
        const fwProgress = Math.min(1, (Math.abs(m.erpm) - baseKvMaxErpm * 0.9) / 3800);
        targetFwId = -10.0 * Math.max(0.15, fwProgress);
      }
      const fwStep = (10 / 0.2) * dt;
      m.idCurrent += Math.max(-fwStep, Math.min(fwStep, targetFwId - m.idCurrent));

      const extraFwBattAmps = Math.abs(m.idCurrent) * 0.45;
      m.inputCurrent = m.motorCurrent * m.duty + (phaseAmps > 0 ? extraFwBattAmps : 0);

      const totalStatorAmps = Math.hypot(m.motorCurrent, m.idCurrent);
      const iSq = (totalStatorAmps / 90) ** 2;
      m.tempFet += (iSq * 3.8 - (m.tempFet - 34.0) * 0.08) * dt;
      m.tempMotor += (iSq * 2.9 - (m.tempMotor - 36.0) * 0.045) * dt;

      const deltaSteps = Math.round((m.erpm / 60) * 6 * dt);
      m.tachometer += deltaSteps;
      m.tachometerAbs += Math.abs(deltaSteps);
    };

    finalize(this.frontMaster, iFront);
    finalize(this.rearSlave, iRear);

    const totalBattCurrent = this.frontMaster.inputCurrent + this.rearSlave.inputCurrent;
    const vIn = Math.max(43.0, this.packRestVoltage - totalBattCurrent * 0.034);
    this.packRestVoltage = Math.max(
      46.0,
      this.packRestVoltage - Math.max(0, totalBattCurrent) * 0.000035 * dt
    );

    const dAh = (totalBattCurrent * dt) / 3600;
    if (dAh >= 0) {
      this.ampHours += dAh;
      this.wattHours += dAh * vIn;
    } else {
      this.ampHoursCharged += Math.abs(dAh);
      this.wattHoursCharged += Math.abs(dAh) * vIn;
    }

    const now = Date.now();
    const toTelemetry = (m: SimMotorState, id: number): VescTelemetry => ({
      tempFet: Number(m.tempFet.toFixed(1)),
      tempMotor: Number(m.tempMotor.toFixed(1)),
      avgMotorCurrent: Number(m.motorCurrent.toFixed(1)),
      avgInputCurrent: Number(m.inputCurrent.toFixed(1)),
      avgId: Number(m.idCurrent.toFixed(1)),
      avgIq: Number(m.motorCurrent.toFixed(1)),
      dutyNow: Number(m.duty.toFixed(3)),
      erpm: Math.round(m.erpm),
      vIn: Number(vIn.toFixed(1)),
      ampHours: Number(this.ampHours.toFixed(3)),
      ampHoursCharged: Number(this.ampHoursCharged.toFixed(3)),
      wattHours: Number(this.wattHours.toFixed(1)),
      wattHoursCharged: Number(this.wattHoursCharged.toFixed(1)),
      tachometer: m.tachometer,
      tachometerAbs: m.tachometerAbs,
      faultCode: this.faultCode,
      faultText: faultCodeToRu(this.faultCode),
      controllerId: id,
      updatedAt: now,
    });

    return {
      frontMaster: toTelemetry(this.frontMaster, 0),
      rearSlave: toTelemetry(this.rearSlave, 1),
    };
  }
}
