import { describe, expect, it } from "vitest";

import {
  DEFAULT_DRIVETRAIN_CONFIG,
  Drivetrain,
  parseDrivetrainConfig,
} from "../../src/engine/drivetrain";
import {
  RotationalDynamics,
  rpmToRadPerSecond,
} from "../../src/engine/dynamics";
import { singleCylinderPreset } from "../../src/presets/single-cylinder";

function configuredVehicle(): Drivetrain {
  const vehicle = new Drivetrain();
  vehicle.setGear(1);
  vehicle.setClutch(1);
  return vehicle;
}

describe("Drivetrain", () => {
  it("keeps neutral and disengaged clutch free of wheel drive and engine load", () => {
    const neutral = new Drivetrain();
    neutral.setClutch(1);
    const disengaged = new Drivetrain();
    disengaged.setGear(1);
    for (let step = 0; step < 1_000; step += 1) {
      neutral.advanceFixedStep(rpmToRadPerSecond(4_000));
      disengaged.advanceFixedStep(rpmToRadPerSecond(4_000));
    }
    expect(neutral.getState().vehicleSpeedMps).toBe(0);
    expect(disengaged.getState().vehicleSpeedMps).toBe(0);
    expect(neutral.getEngineLoadTorqueNm()).toBe(0);
    expect(disengaged.getEngineLoadTorqueNm()).toBe(0);
  });

  it("transfers more torque with more clutch coupling and slows under speed-dependent resistance", () => {
    const half = new Drivetrain();
    half.setGear(1);
    half.setClutch(0.5);
    const full = configuredVehicle();
    for (let step = 0; step < 1_000; step += 1) {
      half.advanceFixedStep(rpmToRadPerSecond(3_000));
      full.advanceFixedStep(rpmToRadPerSecond(3_000));
    }
    expect(full.getVehicleSpeedMps()).toBeGreaterThan(
      half.getVehicleSpeedMps(),
    );
    expect(full.getVehicleSpeedMps()).toBeGreaterThan(0);
    const beforeCoast = full.getVehicleSpeedMps();
    full.setClutch(0);
    expect(full.getEngineLoadTorqueNm()).toBe(0);
    for (let step = 0; step < 1_000; step += 1) full.advanceFixedStep(0);
    expect(full.getVehicleSpeedMps()).toBeLessThan(beforeCoast);
    expect(full.getVehicleSpeedMps()).toBeGreaterThanOrEqual(0);
  });

  it("lowers engine RPM while accelerating the vehicle when engaged", () => {
    const freeEngine = new RotationalDynamics(singleCylinderPreset.config, {
      initialRpm: 3_000,
    });
    const coupledEngine = new RotationalDynamics(singleCylinderPreset.config, {
      initialRpm: 3_000,
    });
    const vehicle = configuredVehicle();
    freeEngine.setThrottle(0.55);
    coupledEngine.setThrottle(0.55);
    for (let step = 0; step < 1_000; step += 1) {
      vehicle.advanceFixedStep(coupledEngine.getAngularVelocityRadPerSec());
      coupledEngine.setLoadTorque(vehicle.getEngineLoadTorqueNm());
      coupledEngine.advanceFixedStep();
      freeEngine.advanceFixedStep();
    }
    expect(coupledEngine.getRpm()).toBeLessThan(freeEngine.getRpm());
    expect(vehicle.getVehicleSpeedMps()).toBeGreaterThan(0);
    expect(Number.isFinite(coupledEngine.getRpm())).toBe(true);
  });

  it("matches fixed steps at common audio rates without allocating a state each frame", () => {
    const fixed = configuredVehicle();
    const realtime = configuredVehicle();
    for (let step = 0; step < 1_000; step += 1)
      fixed.advanceFixedStep(rpmToRadPerSecond(3_000));
    for (let frame = 0; frame < 48_000; frame += 1) {
      realtime.advanceRealtimeFrame(rpmToRadPerSecond(3_000), 48_000);
    }
    expect(realtime.getState()).toEqual(fixed.getState());
  });

  it("rejects invalid configuration and controls without changing its prior state", () => {
    const valid = parseDrivetrainConfig(DEFAULT_DRIVETRAIN_CONFIG);
    expect(valid.ok).toBe(true);
    const invalid = parseDrivetrainConfig({
      ...DEFAULT_DRIVETRAIN_CONFIG,
      gearRatios: [1, -2],
      vehicleMassKg: -1,
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.issues.map((issue) => issue.path)).toEqual(
        expect.arrayContaining([
          "$.gearRatios[0]",
          "$.gearRatios[1]",
          "$.vehicleMassKg",
        ]),
      );
    }
    expect(
      () =>
        new Drivetrain({
          ...DEFAULT_DRIVETRAIN_CONFIG,
          wheelRadiusM: Infinity,
        }),
    ).toThrow(RangeError);
    expect(
      () =>
        new Drivetrain({
          ...DEFAULT_DRIVETRAIN_CONFIG,
          gearRatios: [0, 1e300],
        }),
    ).toThrow(RangeError);
    const vehicle = configuredVehicle();
    expect(() => vehicle.setGear(-1)).toThrow(RangeError);
    expect(() => vehicle.setGear(1.5)).toThrow(RangeError);
    expect(() => vehicle.setGear(7)).toThrow(RangeError);
    expect(() => vehicle.setClutch(1.1)).toThrow(RangeError);
    expect(() => vehicle.setClutch(NaN)).toThrow(RangeError);
    expect(() => vehicle.advanceFixedStep(Infinity)).toThrow(RangeError);
    expect(() => vehicle.advanceRealtimeFrame(100, 0)).toThrow(RangeError);
    expect(vehicle.getState()).toEqual({
      gear: 1,
      clutchCoupling: 1,
      vehicleSpeedMps: 0,
      engineLoadTorqueNm: 0,
    });
  });

  it("supports gear 6 with overdrive cruising characteristics and finite states", () => {
    expect(DEFAULT_DRIVETRAIN_CONFIG.gearRatios).toHaveLength(7);
    expect(DEFAULT_DRIVETRAIN_CONFIG.gearRatios[0]).toBe(0);
    expect(DEFAULT_DRIVETRAIN_CONFIG.gearRatios[5]).toBe(3.4);
    expect(DEFAULT_DRIVETRAIN_CONFIG.gearRatios[6]).toBe(2.8);

    const vehicle = new Drivetrain();
    vehicle.setGear(6);
    vehicle.setClutch(1);
    expect(vehicle.getState().gear).toBe(6);

    for (let step = 0; step < 1_000; step += 1) {
      vehicle.advanceFixedStep(rpmToRadPerSecond(3_000));
    }

    expect(vehicle.getVehicleSpeedMps()).toBeGreaterThan(0);
    expect(Number.isFinite(vehicle.getVehicleSpeedMps())).toBe(true);
    expect(Number.isFinite(vehicle.getEngineLoadTorqueNm())).toBe(true);
    expect(vehicle.getEngineLoadTorqueNm()).toBeGreaterThanOrEqual(0);

    // Under unresisted acceleration to synchronization, gear 6 reaches higher top speed than gear 5
    const freeConfig = {
      ...DEFAULT_DRIVETRAIN_CONFIG,
      rollingResistanceN: 0,
      aerodynamicDragNPerMpsSquared: 0,
    };
    const v5 = new Drivetrain(freeConfig);
    v5.setGear(5);
    v5.setClutch(1);
    const v6 = new Drivetrain(freeConfig);
    v6.setGear(6);
    v6.setClutch(1);
    for (let step = 0; step < 30_000; step += 1) {
      v5.advanceFixedStep(rpmToRadPerSecond(2_000));
      v6.advanceFixedStep(rpmToRadPerSecond(2_000));
    }
    expect(v6.getVehicleSpeedMps()).toBeGreaterThan(v5.getVehicleSpeedMps());

    expect(() => vehicle.setGear(7)).toThrow(RangeError);
  });
});
