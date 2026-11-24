# Flight test stand — stages 1–6

**Live demo: https://crocone.github.io/flying-test/** — the whole stand runs in your browser. Building a vehicle from a description or an image needs your own server and AI key (`npm run api`), so it is switched off in the demo; pick one of the examples.

> The check scripts (`npm run check`, `npm run physics`) print outcomes in Russian: ПРОЙДЕН = PASS, РАСХОЖДЕНИЕ = DIVERGENCE (a known, explained mismatch with measurements), ПРОВАЛ = FAIL, СПРАВОЧНО = INFO. The stand UI has a Russian/English switch.

## R22 in free flight and its stress tests to FAR 27 (2026-11-24)

```bash
VALIDATE_ONLY=helistress npm run physics -- --validate   # the helicopter series vs. the R22 POH and Robinson safety notices (~10 min)
VALIDATE_ONLY=heli,r22 npm run physics -- --validate     # earlier R22 checks, re-run after the rotor changes
npm run check   # everything together (both stress sections included): 505 checks — 389 pass, 115 "DIVERGENCE", 1 failure: three new R22 names had no English translation — fixed after the run and checked separately
```

### Free flight

Until now the helicopter was only ever tested with its body held (hover — vertical only, forward flight — in a "tunnel").
For the stress tests it now flies freely in all six degrees of freedom:

- **Tail rotor as a force** (`Sim.tailRotorFree`, `tailRotor.at`, `tailRotor.channel`). The pedals set the tail-rotor blade pitch;
  thrust comes from BEMT with the flow through the disc (sideslip and yaw rate change it — this is what gives the tail rotor its
  weathercock effect), and it acts on the boom. Its power is taken from the main rotor shaft, as before. Programmes with the
  body held keep the old model (thrust = rotor torque / arm).
- **Body rates in the flapping equation.** The inertial moment about each hinge is now summed over the blade elements, the same
  way the loads are: Iβ·β̈ = M + M_g − Σ m·(d × (ω̇ × d + ω × (ω × d)))·ê, with ω the hub's rotation together with the body. When
  the fuselage pitches, the disc lags behind the shaft and damps it (checked: at q = 0.2 rad/s the disc tilts 0.38° forward
  relative to the shaft; theory a₁ = −16q/(γΩ) gives about 0.7° for an estimated Lock number of 4.5). Gravity in the flapping
  equation is now g − a_hub: in a pull-up the blades cone up.
- **No false gyroscope.** The blades are rigid Rapier bodies with the flapping laid over them, so when the fuselage turned,
  Rapier turned the whole spinning rotor with it and sent its gyroscopic moment into the fuselage through the joint — hundreds of
  N·m per 0.1 rad/s, a false pitch-roll coupling that made free hover diverge. A real hinge cannot transmit it; that moment is now
  applied to the blade body itself.
- **R22 geometry** from the maintenance manual drawing (ch. 16, fig. 16-2, scaled by the 259 in dimension): horizontal stabiliser
  34 in span, about 8 in chord, 148 in behind the mast, set 2.8–3.3° nose down; upper and lower fins about 18 and 17 in tall;
  tail rotor 174 in behind the mast (POH: 172), 73 in above ground.
- **The centre of gravity was 5.4 in behind the mast** — outside the R22 envelope (POH fig. on p. 2-5: about 95–102 in, mast at
  station 100). With the body held it did not matter; in free flight it was a 1000 N·m nose-up moment. The cabin mass is now
  0.215 m forward, putting the CG at station 98 (an estimate inside the envelope).
- **The engine as a torque with a power limit.** In free flight the mast joint has no Rapier motor (Rapier's velocity motor
  holds rpm with any torque — the first free runs flew on up to 250 kW with a 97.7 kW engine). A governor holds 104 % rpm with
  torque up to available power / Ω (minus transmission losses); the tail rotor is driven from the same shaft. When the demand is
  higher, the rotor rpm droops; in a pull-up it rises above 104 % — the engine cannot brake it.
- **A pilot autopilot** (`src/core/helipilot.ts`): collective holds vertical speed, cyclic holds attitude with rate damping,
  attitude is set by speed and drift, pedals hold heading or zero sideslip.

Free flight against the held "tunnel" trim (which matched Robinson's power data earlier): 60 kt — 42–46 kW vs. 44.8, collective
11.3–11.6° vs. 11.45°; 90 kt — about 77 kW vs. 73.6, collective 12.9–13.9° vs. 13.3°.

### The series

The helicopter takes off, hovers, accelerates, and is moved to 600 m. Criteria where the rules or the POH give one; the rest
are measurements. Blade strength in forward flight stays for reference only (see "R22 in forward flight": equivalent spar, hub
suspension not published — the root margin is below 1 already in level flight at 90 kt), so blades do not break in this programme
and the verdict is not based on it.

| Test (rule) | What is done | R22, model |
| --- | --- | --- |
| Hover out of ground effect | 600 m, 1370 lb | ✅ 72.4 kW of 97.7; 43 % pedal travel left |
| Cyclic pull-up at 0.6 / 0.9 VNE (§27.337) | aft cyclic to +3.5 g, collective fixed | 2.2 / 3.2 g — the rotor stalls first (the R22 design limit is not published); rpm rises to 104 % |
| Low-G pushover (prohibited on the R22) | forward cyclic to 0.2 g, lateral cyclic and pedals fixed | rolls **right** at 22 °/s — as the POH and SN-11 warn |
| 30 ft/s vertical gust (§27.341) | hover / 0.6 VNE / VNE, controls fixed through the gust | 1.29 / 1.74 / 1.91 g |
| Full pedal in 0.2 s (§27.351) | hover / 0.6 VNE | 166 °/s; 81° sideslip at 61 kt (the rule allows up to 90°) |
| Engine failure at 0.9 VNE (§27.143(e)) | controls fixed 1 s, then autorotation at 65 kt | ✅ 83 % rpm after 1 s, steady 96–104 % (POH: 90–110 %); 1340 ft/min (SN-38: usually below 1500) |
| 1.1 VNE (§27.175, AC 27-1) | 112 kt | ✅ 40 % forward cyclic left; not enough power for level flight — flown at −4 m/s at full power, rpm 100 %, 7.5 % of blade sections stalled, advancing tip M 0.78. Held level instead, the collective "eats" the rpm (down to 91 %, below the 97 % low-rpm horn) and retreating-blade stall grows to a third of the disc |

### Limitations

- The engine failure is the last test: the programme ends in autorotation.
- No vortex ring and no ground contact on the skids, so the vortex ring and dynamic rollover tests are not in the series.
- The governor is ideal (no lag, no throttle correlator); the engine power does not depend on rpm. A low-rpm test (raising the collective with the throttle fixed) is not in the series.
- The flapping hinges are at the hub centre. The real R22 has a teetering hinge plus coning hinges slightly off the axis (offset
  not published). With the hinge at the centre, the blade root 0.45 m out carries the hinge shear × 0.45 m in bending — the hover
  blade margin is now 3.3 (it was 6.4 with the old flapping equation, which passed a moment "through" the hinge).
- The R22 load factor limit, transient rpm minimum and teeter stop angle are not published — reported as measured, without a
  pass/fail.
- The main-rotor wake on the stabiliser and fins is not modelled.
- Validation: 5 checks against what a certified R22 does (hover OGE at max weight, autorotation rpm and sink rate, right roll
  in low G, forward cyclic left at 1.1 VNE) — all pass.

## Stress tests to FAR 23 — and what they exposed in the physics (2026-11-24)

```bash
VALIDATE_ONLY=stress npm run physics -- --validate          # the stress programme on the Cessna 172S vs. POH and the rules (~7 min)
VALIDATE_ONLY=sixdof,cessna npm run physics -- --validate   # roll on full aileron, POH tables — re-checked after the aerodynamics changes
npm run check   # see the R22 section above for the latest full run (505 checks); the run before the helicopter work: 500 checks — 384 pass, 115 "DIVERGENCE", 1 failure ("influence calculation within 60 s": 64.5 s with the CPU busy, 37.8 s alone)
```

### The programme

New programme **"Stress tests (FAR 23)"** for fixed-wing aircraft (`stress` in `src/core/programs.ts`). Sources for the list and
the criteria are in `data/stress-tests.md`. The aircraft takes off, then flies a series of certification manoeuvres at 1500 m.
Each manoeuvre has a target from the rules, a measurement and a pass/fail. The strength criterion everywhere is a safety
margin of at least 1.5 at the limit load (§23.303, §23.305). In the browser, setup and recovery between manoeuvres are
fast-forwarded; take-off and the manoeuvres themselves play in real time.

| Test (rule) | What is done | Cessna 172S, model |
| --- | --- | --- |
| +3.8 g at VA (§23.333, §23.337) | entry at 1.05·VA = 108 kt, pull to the limit, 1 s | 3.55 g at 107 kt — the wing stalls first (that is what VA means); margin 1.92 |
| +3.8 g at VC = 33·√(W/S) = 127 kt | pull, 1 s | 3.79 g, margin 1.84 |
| −1.52 g at VC (§23.337(b)) | push, 1 s | −1.67 g (the autopilot overshoots by 10 %), margin 3.93 |
| ±50 ft/s gusts at VC (§23.333(c), §23.341) | 1 − cos gust over 25 chords, frozen in the air; elevator fixed | **3.82 / −1.90 g; the rule's formula gives 3.83 / −1.83**; margin 1.80. With a gust applied to the whole aircraft at once it was 3.34 / −1.25 |
| Checked pitch manoeuvre at VA (§23.423) | full aft stick to the limit, then forward | 3.31 / −0.63 g, margin 2.09 |
| Rolling pull-out (§23.349, §23.455) | from a 60° turn at 2/3 of the limit g, full aileron to roll out | 82 °/s, margin 2.78 |
| Full rudder at VA (§23.351) | step to the peak sideslip, then neutral | 13.2°, margin 6.85 |
| Dive to VD = 1.4·VC = 178 kt (§23.251, §23.33) | full throttle, rpm held at the red line; 1 s at VD; pull-out | 175 kt; windmilling 2940 rpm with the throttle closed (110 % = 2970 allowed); flutter far away |
| Wings-level stall (§23.201) | 1 kt/s, power off, controls fixed for 1 s at the break | **52 kt (POH: 53 KCAS)**; bank 5°; 55 m lost (POH: up to 230 ft = 70 m) |
| Turning stall, 30° (§23.203) | 1 kt/s | **54.5 kt (POH: 57 KCAS)**; bank −24…+36° (allowed 60/30) |
| Accelerated turning stall (§23.203) | 4 kt/s with rising g | 62.5 kt; bank −24…+43° |
| One-turn spin (§23.221) | full aft stick and rudder at the break | **not reproduced**: the model settles into a spiral (see limitations) |

### What the tests found in the physics

The first runs gave margins that jumped by ±30 % from one sample to the next and a roll rate twice the real one. The cause
was in the physics, not in the tests:

1. **Wing bending had no air damping in free flight.** The aerodynamic damping of the first bending mode was computed from the
   wind-tunnel flow, which is zero when the aircraft flies freely. So the wing rang at 3 % damping after every control input.
   Now damping follows the current airspeed: about 10–15 % for the Cessna wing in flight (`sim.ts`, `elasticInfo` and the load
   step).
2. **In-plane wing bending went through the narrow spar only.** When the wing has a torsion box, in-plane bending is now carried
   by the whole box: spar, upper and lower skins, rear web (`section.ts`). Stiffness is 17× higher, the spurious 4 Hz in-plane
   ringing is gone, and the margin in the checked manoeuvre went from 1.41 to over 1.9.
3. **One uniform induced angle per wing half → a lifting line.** Each strip of the main wings is now a horseshoe vortex.
   Induced angles come from Biot–Savart over all strips of both halves, solved each step by a Newton step (plain iteration
   diverges on the saw-tooth mode). Before, lift did not fall off at the tip and antisymmetric loading (ailerons, roll rate) was
   barely damped by downwash. Flapping wings keep the previous model: their wake is unsteady, and a quasi-steady lifting line
   made the Snowbird check worse (thrust margin 0.54 → 0.40 against a measured 0.92). The "straight wing in a tunnel" check
   used a single half-wing and the full-wing formula: the old model silently assumed the missing half. It is now a full
   rectangular wing of aspect ratio 10, compared with an independent method — Glauert's Fourier-series solution of the
   lifting line: lift +2.2 %, induced drag within 0.4 %.
4. **Control surfaces followed thin-airfoil theory at any deflection.** With `control.chordFrac` (c_f/c) set, two DATCOM
   corrections are added (sec. 6.1.1.1, digitised in Roskam Part VI): the viscous one (a real surface is weaker than theory)
   and the nonlinear K'(δ) for large deflections. The method reproduces NACA TR 661 (23012, 0.2c flap) to ±0.03 in Δc_l up to
   20°. Set for the Cessna aileron, elevator and rudder.
5. **The gust hit the whole aircraft at once.** It was a uniform vertical wind, so the tail felt it together with the wing.
   Now a gust is frozen in the air (`sim.gustAt`): the aircraft flies through it, and every strip of the wing and the tail sees
   it at its own position — the tail l_t/V later. That is how the rules' gust alleviation factor is derived.
6. **Crew vibration in the stress programme.** The vibration measure (ISO 2631, RMS over 2 s) is meant for sustained shaking;
   gusts and abrupt controls are one-off jolts, already assessed by the g-load by axis and the Brinkley impact model. In this
   programme vibration is measured only in steady flight between manoeuvres (a note in the report says so). The recovery
   after each manoeuvre now starts with a smooth 1.5 s unload — the autopilot used to push from 3.7 g to 0.2 g in about a second.

| Quantity | Before | After | Reference |
| --- | --- | --- | --- |
| Aileron power C_lδa, 1/rad | 0.48 | 0.30 | JSBSim 0.23, UIUC 0.18 (calculations) |
| Roll damping C_lp | −0.62 | −0.48 | JSBSim −0.47 |
| pb/2V on full aileron, 104 kt | 0.24 | 0.18 | Cessna 177B in flight 0.09 (NASA CR-2337) — **divergence** |
| Cruise power vs. POH table, mean | −6.6 % | −2.8 % | POH fig. 5-8 |
| Rate of climb, 0 / 8000 ft | +15 / +16 % | +10 / +5 % | POH fig. 5-7 |
| Stall, flaps up | −0.4 % | +0.4 % | POH 53 KCAS |
| POH section of the checks (24) | 16 pass, 8 divergences | 14 pass, 10 divergences | climb at 8000 ft now passes; top speed at 8000 ft (−4.3 %, limited by the 2700 rpm of the "light" propeller) and three cruise rpm rows went just over tolerance |

### Why it diverges

- **Roll rate**: still twice the Cessna 177B in flight. That is a different aircraft (cantilever wing, its own ailerons). In the
  test the pedals were held, so adverse yaw built 8–11° of sideslip, which slows the roll through dihedral effect. The model has
  no aileron hinge gaps and almost no adverse yaw. The calculated C172 models give 0.12–0.15.
- **Propeller rpm** in cruise is 2–4 % high (the known "light propeller", see the propeller section). With the lower drag of
  the lifting line it shows up in more rows: 3 of the cruise rpm checks went just over their 2 % tolerance.
- **The 30° turning stall** is 4.4 % below the POH: the programme detects the stall by the share of stalled strips (30 %), the
  certification test by the nose drop or the stick reaching its stop.

### Limitations

- **The spin is not reproduced.** With full aft stick and rudder the model sits at α ≈ 14° in a spiral. Autorotation needs
  rotary-balance data for the wing beyond the stall, which strip theory does not have. The step is reported as "not tested".
- **Strength margins belong to the equivalent cantilever spar** (its wall is an estimate; the strut is not in the strength
  calculation). They are not a check of the real airframe.
- The autopilot is a test pilot with limits: at VA the wing stalls at 3.55 g before reaching 3.8 g, and −1.52 g overshoots to
  −1.67 g. Both are shown as measured.
- The helicopter series is described in the next section up (R22 in free flight).

## Human: power vs. duration, g-loads by axis and time (2026-11-23)

```bash
VALIDATE_ONLY=human npm run physics -- --validate   # checks for this section (seconds)
npm run check   # everything together: 493 checks — 382 pass, 111 "DIVERGENCE", no failures
```

The full run had one failure: a verdict text contained a number that was not in the telemetry. It was fixed after the run
and checked separately. The new crew model did not change the verdicts of earlier tests.

### What was added to the core

- **Human as an engine** (`powerplant.engine: { type: 'human', level: 'healthy' | 'champion', durationS }`).
  - Available power is what a person can sustain for a given time. Source: NASA SP-3006 (1973) curves, fig. 18-15: healthy men and champions.
  - Endurance in the report comes from the inverse curve: how long the person can last at the required power.
- **Crew g-loads by body axis and duration** (`src/core/crew.ts`, `CrewLoad`). Previously there was a g-load module checked against a single threshold; now:
  - **Sustained.** Averages along ±Gx, Gy, ±Gz over windows from 1 to 1200 s are compared against two curves:
    - the NASA-STD-3001 limit (rev. C, 2022) for a healthy crew — "severe";
    - average tolerance of healthy people (Chambers 1963, via SP-3006) — "dangerous".
  - **Loss of consciousness (G-LOC).** +Gz averaged over 5 s from 5.4 g (Cochran 1954, unprotected) — "no one left to fly the aircraft".
  - **Impact.** Brinkley model: spinal response along three axes, coefficients from NASA/TM-2013-217380. The combined axis index β is compared with NASA limits for low (< 0.5 %) and moderate (0.5–5 %) injury risk.
  - The old "sustained / peak g-load" values remain in the telemetry for comparison. The crew verdict names whatever exceeded its limit: axis, window, limit, impact, vibration.

### What the checks showed

| Check | Result |
| --- | --- |
| Healthy human power (SP-3006) vs. Whitt & Wilson 1982, 5 points | pass, 0–4 % |
| Champion power vs. professional cyclists (Pinot & Grappe 2014, Valenzuela 2022, Gallo 2022, Wilkie 1960), 14 points | 10 pass; 4 **divergences** at efforts of 30 s – 5 min: modern racers are 11–18 % higher |
| Daedalus: 3.1 W/kg for 6 hours | info: extending the curve gives 227 W (beyond the data) |
| +Gz tolerance vs. test pilots (Chambers & Hitchcock 1963): 9 g — 8 s, 8 g — 29 s, 6 g — 157 s | 2 pass (3 and 2 %), 1 **divergence** +16 % at 8 s |
| Brinkley model vs. rocket sled tests (Stapp; SP-3006), 7 tests | all tests with injury are above the low-risk limit: pass |

**Info.** The Brinkley model also places impacts survived without harm in the moderate-risk band: −Gx 45 g for 0.09 s and +Gx 30 g for 0.11 s. NASA limits are for design, with margin. The pulse shapes in the tests were not recorded: a trapezoid is assumed.

**Loss of consciousness** across different centrifuges: Cochran 5.4 ± 0.9 g, Zarriello 5.3 ± 0.8, Kasture 4.89 ± 0.67, Chiang 5.1 ± 0.9. The others use different endpoints: loss of peripheral or central vision, which comes earlier.

### Limitations

- Human power does not depend on altitude. Above 1500 m aerobic power drops; in the model it does not. Body mass is not given in the SP-3006 curves: power is absolute, in watts.
- The NASA limit assumes a restraint harness and an anti-g suit. Chambers tolerance is voluntary, for healthy subjects. There is no tolerance curve for Gy; the NASA emergency limit is used instead.
- Consciousness under negative g (−Gz) is not assessed separately — only via the curves.
- The occupant sits facing forward; body axes coincide with the airframe axes.

## Structure: wing flutter and divergence, laminated composites (2026-11-23)

```bash
VALIDATE_ONLY=structure npm run physics -- --validate   # checks for this section (seconds)
npm run check   # everything together: 470 checks — 364 pass, 106 "DIVERGENCE" (full run 2026-11-23 — 469 checks; the strut-braced Cessna flutter check was added after it and passed separately; the "influence calculation within 60 s" check did not fit in that run — 130 s with the CPU busy with other programs)
```

### What was added to the core

- **Wing flutter and divergence** (`src/core/aeroelastic.ts`).
  - A beam with an elastic axis; mode shapes by the finite element method (bending — Euler–Bernoulli beam, torsion — a rod, coupling — via the offset of the center of mass); the four lowest are used.
  - Supports: the root is clamped or hinged; the strut (`structure.strut`) is a vertical support at its attachment point on the chord: it couples deflection with twist.
  - Theodorsen unsteady aerodynamics, strip by strip.
  - Solved by the p-k method: at each speed the roots of the characteristic polynomial are found. Flutter is the speed where an oscillation stops decaying. Divergence is where torsion loses static stability.
- **Flutter in the stand** (`Sim.flutterInfo`). Computed for a stationary wing with a specified torsion box `structure.torsionBox` — the skin between the spars that carries torsion. From the part's structure the following are taken:
  - EI — of the spar;
  - GJ — of the torsion box, by the Bredt formula;
  - elastic axis — the middle of the torsion box;
  - mass distribution — the spar at `sparAt`, the skin along the chord.

  Without a torsion box the torsional stiffness is unknown, and flutter is not checked.
- **Cessna 172S: torsion box and strut are estimates** (assumptions "Wing torsion box skin" and "Strut attachment"). There is no data: the Cessna structural repair manual (SESR04) gives only materials; there are no wing stiffnesses or frequency measurements. Spars at 20 and 65 % chord, skin 0.020 in, strut to the front spar at 2.6 m from the centerline, root hinged. Result: no wing flutter up to 270 m/s, divergence from 690 m/s for any combination of estimates (skin 0.016–0.025 in, spars ±5 % chord, strut ±0.3 m). This is a plausibility check: the aircraft is certified, and the regulations require freedom from flutter up to 1.2·V_D ≈ 112 m/s. Without the strut the same cantilever diverges at 192 m/s, and the first frequency drops from 12.8 to 6.5 Hz. Aileron flutter (on the real aircraft they are mass-balanced) is not computed.
- **Flutter in the verdict.** If the test speed reached the flutter or divergence speed — "Breaks up". If the margin is below 20 %, a warning (CS-23.629 requires 1.2 times the design dive speed). The report has a line "Wing flutter and divergence".
- **Laminated composite** (`src/core/laminate.ts`, `structure.layup`: fractions of 0°, ±45°, 90° plies).
  - Stiffness — by classical laminate theory.
  - Strength — by maximum strain in ply axes, with cracked plies switched off: fibers break — the laminate has failed; the matrix cracks — the ply loses transverse stiffness and the load is redistributed.
  - Without a layup, the composite is unidirectional along the span, as before.
  - Materials now have `Yt` and `Yc` — ply strength transverse to the fibers.

### What the checks showed

| Check | Model | Measured | Result |
| --- | --- | --- | --- |
| Goland wing (computational benchmark) | 137.0 m/s, 68 rad/s | 137 m/s, ≈70 rad/s | pass |
| NACA TN 1594, run 96 (air) | 104.3 m/s | 101.7 m/s | pass, +2.6 % |
| run 60 (air) | 100.0 m/s | 103.0 m/s | pass, −2.9 % |
| run 5 (Freon-12, ρ four times higher) | 57.3 m/s | 55.4 m/s | pass, +3.4 % |
| Flutter frequency | 24.6 / 24.8 / 27.2 Hz | 22.1 / 22.0 / 25.2 Hz | **divergence** +8–13 % |
| Frequencies: bending, second bending, torsion | 6.65 / 41.6 / 48.6 Hz | 6.25–6.45 / 35.8–39.2 / 44.6–47.6 Hz | **divergence** +5–10 % |
| Cessna 172S, torsion box and strut are estimates | no flutter up to 270 m/s, divergence ≥ 690 m/s | regulations: none up to 1.2·V_D ≈ 112 m/s | pass (plausibility) |
| NCAMP laminates, compressive modulus (3 layups) | | | pass, 0.1–0.8 % |
| NCAMP laminates, tensile modulus (4 layups) | | | 1 pass, 3 **divergences** +5–6 % |
| Tensile strength: 10/80/10 / 25/50/25 / 50/40/10 / [0/90] | 463 / 879 / 1410 / 1287 MPa | 462.5 / 717 / 1215 / 1166 MPa | 1 pass, 3 **divergences** +10…+23 % |
| Compressive strength: 10/80/10 / 25/50/25 / 50/40/10 | 422 / 661 / 1016 MPa | 465 / 600 / 835 MPa | 1 pass, 2 **divergences** +10 and +22 % |

### Why it diverges

- **Flutter frequency.** 8–13 % higher than the real one, even with four modes: the cause is strip theory (no tip losses), not the number of modes. NACA's 1949 calculation with the same theory gave the same error: 25.27 Hz vs. 22.1. The flutter speed still agrees.
- **Natural frequencies.** The clamp in the model is perfectly rigid; the real one in the tunnel is more compliant.
- **Laminate strength is overestimated.** A calculation based on the failure strain of a unidirectional ply (1.58 %) does not know that fibers in a laminate break earlier: a quasi-isotropic one fails at 1.25 %. This is a known effect: stress concentration at specimen edges, cracking of neighboring plies, interlaminar stresses at free edges. So the model rates parts with a layup as stronger than real ones — by up to 20 %. No correction factor was fitted.
- **Ply compression.** NCAMP back-calculated the ply compressive strength from a cross-ply specimen using this same theory, so compression is not a fully independent check.

### Limitations

- Strip theory: no tip losses, no compressibility. Above M ≈ 0.5 the flutter speed is overestimated.
- The strut is accounted for only in flutter: spar strength is still computed as for an equivalent cantilever.
- Flutter of propeller blades and flapping wings is not computed: the oscillations there are of a different nature.
- Wing-mounted masses (tanks, engines) are not included in flutter.
- Nonlinear large-deflection flutter (as on the Pazy wing) is outside the model.

## R22 in forward flight and autorotation: flapping blades, cyclic pitch, freewheel clutch (2026-11-23)

```bash
VALIDATE_ONLY=heli npm run physics -- --validate   # checks for this section (about 4 min)
npm run check   # everything together: 440 checks — 347 pass, 93 "DIVERGENCE", no failures
```

The last full run had one failure: translations of two new control labels were missing. They were added
after the run; the translation check passes separately.

### What was added to the core

- **Blades on flapping hinges** (`flapping` on the rotor). This is how the R22 hub is built per the POH: teetering, with coning hinges.
  - Each blade's flapping has its own equation: Iβ·β̈ = M_aero + M_grav − Iβ·Ω²·(β₀ + β). Centrifugal force restores the blade at exactly once per revolution.
  - The blade stays a rigid body in Rapier. Flapping is superimposed on the position and velocity of the sections in the aerodynamics and loads, and the moment about the hinge is removed from the body — it is not transmitted to the hub.
  - Coning settles by itself: 1.8° in hover (the previous constant-coning estimate was 2°).
  - Blade loads include the blade's acceleration due to flapping (angular, centripetal, Coriolis).
- **Cyclic pitch** (`cyclic`): blade angle += cos·cos ψ + sin·sin ψ by azimuth. The rotor axis for the flow is the normal to the tip-path plane.
- **Freewheel clutch** (`freewheel`): the engine disengages; rpm is set by the flow and the rotor inertia. The tail rotor is driven by the main rotor and brakes it with its profile power.
  - The joint motor in Rapier cannot be switched off: with zero coefficients the joint becomes rigid. So the shaft joint is recreated without a motor.
- **Main rotor power is computed with sign.** Coriolis forces rock the shaft twice per revolution, averaging zero. Taking only the positive part overestimates power fourfold. Tail rotor thrust is based on torque smoothed over 0.5 s.
- **Forward flight in a "tunnel"** (`src/cli/rotorflight.ts`): the fuselage is free vertically, with flow from the front. Autopilot:
  - collective holds vertical speed, and in autorotation — rpm;
  - longitudinal cyclic balances drag;
  - lateral cyclic balances tail rotor thrust.

### What the checks showed

| Check | Model | Reference | Result |
| --- | --- | --- | --- |
| 90 kt level | 96.6 hp | 90 HP (Robinson, AAIB 11/98) | pass, +7 % |
| 60 kt, climb 1000 ft/min | 108 hp | 103 HP | pass, +5 % |
| Autorotation 60 and 70 KIAS, 100 % | 1317 and 1498 ft/min | "usually less than 1500" (POH, SN-38) | pass |
| Autorotation 75 KIAS, 90 % | 1460 ft/min, glide ratio 5.2:1 | about 1900 ft/min (glide ratio 4:1, POH) | **divergence** −23 % |
| Minimum rate of descent at 90 % | at 45 kt, the curve is flat: 1069–1101 ft/min at 40–53 kt | 53 kt (Flight Training Guide) | pass (45–60 kt) |
| R22 hover (earlier checks) | 71.1 kW, as before | | unchanged |

Info:
- Blade flapping at 90 kt is ±5°, the tail rotor takes 6 hp.
- Rotor rotational energy at 104 % is 298 HP·s, the margin down to 80 % is 122 HP·s. Robinson quotes 100 HP·s, but whether that is the total energy or the margin is unclear from the text.

### Why it diverges and what is missing

- **Autorotation at 75 kt descends slower than the real one.** At this speed about half the losses are fuselage drag (0.59 m², an estimate). The fuselage in the "tunnel" does not pitch, while the real one is nose-up in autorotation.
- **Blade strength in forward flight is info only; failure is disabled.** The margin at the root drops to 0.8 at 90 kt. Reasons:
  - the spar is an equivalent box of 40 % chord; in the plane of rotation it is weaker than the real blade;
  - the hub suspension below the hinge, which on the R22 absorbs Coriolis forces, is not published and is not in the model.

  There are no blade load measurements, so there is nothing to fit.
- There is no fuselage trim in pitch and roll, and no free flight of the helicopter in all degrees of freedom: fuselage angular rates do not enter the flapping equation. (Done on 2026-11-24 — see "R22 in free flight" at the top.)
- Inflow through the disk is computed by annuli. There is no inflow skew across the disk in forward flight: the lateral flapping it causes is not reproduced.
- There is no forward-flight program for the helicopter on the page yet — only the checks.

## Cessna 172S in all six degrees of freedom: stability from geometry (2026-11-23)

```bash
VALIDATE_ONLY=sixdof npm run physics -- --validate   # checks for this section (about 5 min)
npm run check   # everything together: 432 checks — 340 pass, 92 "DIVERGENCE", no failures; 88 info lines
```

The overall run figures are assembled from the full run (420 checks) and a rerun of the sections fixed after it.

The aircraft no longer flies "in a plane" with a fitted fuselage mass. It is built from its own data:
- geometry — EASA type certificate and Jane's: a wing with a planform break at 2.10 m, control surfaces with their areas and deflections;
- 17 masses — from the POH equipment list and weighing example: 2550 lb at 42.6 in, as in the POH;
- after liftoff it is free in all six degrees.

Stability is never set as a number — it emerges from the geometry. Sources are in `data/research.md`, part 8.

### What was added to the core

| What | How |
| --- | --- |
| Control surfaces on a span segment | `control.from/to` — the aileron only on its own 2.10–5.41 m; `degNeg` — differential ailerons (up 20°, down 15°). Flap effectiveness — thin airfoil theory τ = 1 − (θf − sin θf)/π |
| Chord along span | `planform` — the wing is not a trapezoid (rectangle up to the break, trapezoid beyond it) |
| Downwash behind the wing | each wing half is a horseshoe vortex (Prandtl, rolled-up tip vortex at π/4 of the span), Γ from the half-wing lift; the tail sees the circulation the wing had (streamwise distance)/V ago — hence the C_mα̇ damping; near the ground — an image vortex |
| Crossflow around the fuselage | in the body cross-section — a 2D doublet: δ = (R²/r²)(c − 2(c·r̂)r̂). Gives upwash at the wing root, high-wing lateral stability in sideslip, and sidewash at the fin |
| Munk moment | a body at an angle to the flow turns broadside: M = ρV(k₁ − k₂)·v_x·(x̂ × v), k₁, k₂ — Lamb |
| Engine torque reaction | `spin` on the propeller: the fuselage receives −Q along the axis (the Lycoming rolls it left) |
| 6-DOF flight | for an aircraft with ailerons the fuselage is free after liftoff; the lateral autopilot holds heading with bank, bank with ailerons, sideslip with the rudder. Bank, heading and sideslip angles are in the output |

### What the checks showed

| Check | Model | Reference | Result |
| --- | --- | --- | --- |
| Lamb coefficients k₁, k₂ (4 ellipsoids) | up to 0.9 % | Lamb's table | pass |
| Downwash at the stabilizer dε/dα | 0.326 | 0.342 (DATCOM, generalization of wind tunnel tests) | pass, −5 % |
| Descent at 1000 ft/min at trim power for 110 KIAS | 136 KIAS | 135 KIAS (AAIB flight test) | pass |
| Speed stability: in descent the elevator goes "nose down" | −5.3° vs. −4.2° | 2 kgf push | pass |
| Phugoid damping ζ | 0.11 | 0.14 from AAIB fig. 5 | pass |
| Phugoid period | 31.6 s | 35–40 s | **divergence** −16 % |
| RPM at 110 KIAS / in descent | 2580 / 2869 | 2500 / 2650 | **divergence** +3 / +8 %: the propeller is "light" (blade geometry not published) |
| Right pedal: roll right, nose down, speed increases | yes | yes (AAIB) | pass |
| Time to 30° bank with 3° rudder | 23 s | "spiral in 10–15 s" | **divergence** |
| POH cruise table, 7 rows | power −6.6 % on average | | was −9.6 %; 4 rows moved to "pass" |
| Rate of climb at sea level / at 8000 ft | +15 / +16 % | POH | was +18 / +17 % |
| Stall 53 KCAS, maximum speed | 0.4 % / within tolerance | POH | as before |

Downwash and the fin added trim drag — and cruise and climb moved toward the POH on their own, without fitting.

**Info (references are calculations, not measurements).** Model stability derivatives; in parentheses — Cessna 182 from NASA CR-1975 and JSBSim c172p:
- C_Lα 5.10 (4.61);
- C_Yβ −0.43 (−0.31; −0.39);
- C_lβ −0.065 (−0.089; −0.092);
- C_nβ 0.117 (0.065; 0.059).

Model moments of inertia are 1792 / 2185 / 3448 kg·m². There are no measurements for the C172. Three computed sources differ from each other by a factor of two, and the model lies between them.

### Why it diverges

- **Phugoid period.** In the test the yoke was released and the elevator is free: it "floats", and the stability margin is smaller than with a fixed elevator. With a smaller margin the phugoid is longer. In addition, propeller slipstream over the tail is not accounted for.
- **Spiral.** The model's lateral stability (C_lβ) is 1.4 times lower than computed, so bank from sideslip builds more slowly. How many degrees of rudder 2 cm of pedal gives is an estimate (≈ 3°): with 4° the model reaches 30° bank in 17 s. On the real aircraft the ailerons are free as well.
- **Directional stability C_nβ.** It is higher than the NASA and JSBSim calculations. But a fin of 1.73 m² (Jane's) with "end-plate aspect ratio" and sidewash per the DATCOM breakdown gives 0.1–0.15. The propeller normal force in sideslip, which reduces directional stability, is not computed in the model.

### Limitations

- Free (floating) control surface: control surface hinge moments are not modeled — a surface stays where it was set.
- The propeller slipstream does not blow over the tail and fuselage. Slipstream swirl, oblique inflow to the propeller and P-factor are not accounted for.
- At large deflections control surfaces are linear: separation from the deflected part is not accounted for.
- The wake behind the wing is straight, streamwise: downwash does not deflect it and it does not roll up gradually.
- The takeoff roll is in a plane: the wheels are not steered on the runway.

## "Aircraft built for the physics": ground effect, per-annulus rotor inflow, polars from wind-tunnel tests (2026-11-22)

```bash
VALIDATE_ONLY=ground,download,rotors,r22 npm run physics -- --validate   # checks for this section
npm run check   # everything together: 406 checks — 314 pass, 92 "DIVERGENCE", no failures; 80 INFO rows (excluding the ISA ± 20 check)
```

Rule: do not tune the model's numbers to fit the answer; add the missing physics instead and define the aircraft by their real data.
The fitted quantities that used to paper over the gaps have been removed. As a result there are more divergences from experiment (87 versus 62):
what used to be hidden in a fitted number is now visible.

### What was added to the core

| What | Before | Now | Check against measurements |
| --- | --- | --- | --- |
| Rotor near the ground | none | Cheeseman–Bennett mirror image with a forward-speed correction (`rotorGroundFactor`, `aero.ts`) | Zbrożek flight points — 0.5–2 %; R&M 3021 flight curves — 0.1–4.3 %; TN 835 test stand at z/R ≥ 1.5 — 2 %, at z/R 0.5–1 the model gives 5–9 % less benefit than experiment |
| Wing near the ground | none | Wieselsberger theory (`wingGroundFactor`) | TN D-926 wind-tunnel tests, h/b 0.05–0.5: 2–8 % |
| Inflow through the main rotor | one value for the whole disk × κ = 1.15 (empirical factor), lift cutoff at the tip | its own value on each annulus of the disk (blade element momentum theory, BEMT) with Prandtl tip losses; no κ | two independent BEMT implementations agree: thrust 0.17 %, power 0.07 %; without profile drag κ comes out at 1.11–1.17 — as in experiments |
| Airfoil polars | 4–5 numbers (c_l0, slope, c_l,max, c_d0, k) | tabulated by section Reynolds number from wind-tunnel tests: NACA 0012 (Ladson, measurements, and Sandia), 0015 (Sandia), 63₂-015 (Report 824); air viscosity from Sutherland | see below |
| Blade surface | none | smooth (as in the tunnel) or with standard roughness — measured separately; an aircraft property, a slider | see below |
| Body drag | a single C_D·S in all directions | longitudinal — C_D·S; lateral — crossflow C_D × planform projected area (Allen–Perkins) | falling body with drag — matches the formula |
| Main rotor wake on the body (download) | none | at each point of the body planform — the wake velocity from the disk annulus the flow came from, with wake contraction | panels under the rotor, TN 3900: near the disk the model underestimates the load by 40–65 %, at 0.64 R — by 20 %; small panel at 0.64 R — 4 % |
| Tail rotor | 15 % loss share (estimate) | its own BEMT with dimensions from the POH; thrust from the main rotor torque (`tailrotor.ts`) | — |

### Blade surface: what the experiments showed

For the same NACA 0012 at Re 2·10⁶, the drag of the smooth airfoil is 0.0062, and with a roughness strip at the leading edge it is 0.011
(Ladson, both values measured). This changes rotor power by 10–15 %. What surface the blades had in the experiment
is unknown, so the check is: the experiment must lie between the smooth and the rough blade.

| Experiment | Model smooth / rough (relative to experiment) | Result |
| --- | --- | --- |
| Carpenter, TN 4357, θ 4° / 7° / 10° | 0.83–1.10 / 0.90–1.06 / 0.92–1.01 | experiment inside the band (63–89 % of the way toward rough) |
| 63₂-015 rotor, TN 3850, C_T 0.0037 | 2.05 / 2.25 ·10⁻⁴ vs. experiment 2.25·10⁻⁴ | inside (at the rough edge) |
| R22, POH, 6 OGE ceiling points | −28 % / −20 % | **divergence**: even with rough blades the model is 20 % low |

### R22

The aircraft has been brought in line with its real data:
- hub height above ground 107 in (was 2.34 m, now 2.72 m);
- tail boom as a separate part;
- tail rotor per the POH: 2 blades, 42 in, 4 in chord, 622 ft/s;
- transmission losses 5 % (estimate, efficiency 0.95) instead of 15 %, in which the tail rotor used to be hidden;
- blade polar from wind-tunnel tests;
- blade surface — a slider, 0.5 by default.

The tail rotor takes about 6.5 % of main rotor power; the wake on the body and boom — 1.4–3 % of thrust.

The model hovers on 20–24 % less power than the POH chart implies. The blade itself is not to blame: a rotor with the same airfoil
(TN 3850) the model computes within the experimental band. Three candidates remain, all outside blade aerodynamics:
- reading the steep part of the POH chart as takeoff 131 BHP — an estimate: if the engine no longer delivers takeoff power there,
  the divergence is smaller;
- the engine cooling fan, the alternator;
- the hub and blade roots.

R22 hover power data from flight tests are needed.

### What got worse than before (and why this is honest)

- **Low-Reynolds-number rotors (TN 626, TN 835, Re 1–2·10⁵):** model power is 12–17 % below experiment. Previously their c_d0
  was taken from the same experiment (from torque at zero thrust), which was a fit. Now the polar comes from the Sandia tables, and at such
  Re those are not measurements but Eppler calculations. Measured NACA 0015 tables at Re 10⁵ could not be found.
- **Harrington coaxial rotor 1:** −20…−26 % in power. Its airfoil thickness varies along the radius from 30 % to 15 %; the model uses
  tabulated 0015 over the whole radius (estimate).

### Engines, fuel, batteries (`src/core/engine.ts`)

| What | Before | Now | Check |
| --- | --- | --- | --- |
| Piston engine at altitude | Gagg–Ferrar: 1.132σ − 0.132 (general formula) | Lycoming chart: P/P₀ = 1 − k·(1 − δ/√θ), k = 1.04 (IO-360-L2A); the R22's derated engine — 131 hp as long as full throttle can deliver it (O-360-J2A, k = 1.10 per Fig. 3-41) | Cessna POH: 77 % at 8000 ft — 2 %, 72 % at 10,000 ft — 2.2 % |
| Air temperature | standard only | ISA ± ΔT: density from the equation of state, engine power from the Lycoming correction √(T_std/T); on the page — an "Air temperature" field | Cessna POH, 8000 ft: ISA and ISA+20 — 2–2.4 %; ISA−20 — **divergence** 5.4 %: per the POH the power gain in the cold is twice the Lycoming correction (closer to the density law) |
| Fuel flow | none | specific fuel consumption from the Lycoming chart (Fig. 3-9) by power fraction; mixture — from best economy to best power | Cessna POH, 16 rows: 12 — POH fuel flow between the two mixtures; 4 rows at 77 % — **divergence**: the POH leans the mixture where Lycoming allows only best-power mixture (above 75 %) |
| Turboshaft engine | σ^0.7 | δ/√θ (corrected parameters), capped at takeoff power; specific fuel consumption by power setting — T700 (GE) curve | INFO: for the TV3-117VM (MAI) fuel consumption at low power settings is 5–15 % higher — different engines |
| Battery | none | energy to cutoff from a measured HV-LiPo discharge curve (SINTEF): delivered capacity and average voltage vs. current | Phantom 4: model 32.9 min vs. "about 28 min" per the spec sheet — **divergence** +17 %: hover power in the model is underestimated; electronics, gimbal and camera draw no power |
| Endurance | none | in the report: how long the fuel or battery will last at the test power | — |

Not done: human muscle power as a source with a "power — time" curve (data collected: NASA SP-3006, Pinot & Grappe,
Daedalus), fuel burn over time with decreasing mass, remaining fuel as a test limit.

### Limitations

- Ground effect on the wake (spreading near the ground) is not included in the body load. Experiment shows that near the ground
  download drops to zero.
- The wake contracts more slowly than for a real rotor (a vortex cylinder behind a uniformly loaded disk), and near the disk
  there are no pulsations from passing blades.
- Tabulated polars so far exist only for the R22 and the rotors in the checks. The Cessna, the quadcopter, the ornithopters and the AI projects
  still use the old parametric polars.

## Cessna 172S fixed-pitch propeller: engine–propeller rpm equilibrium (2026-11-12)

```bash
VALIDATE_ONLY=cessna npm run physics -- --validate   # Cessna section only, about 3 min
npm run check   # (as of 2026-11-12) full run after all three improvements: 346 checks — 284 pass, 62 "DIVERGENCE", no failures
```

A continuation of the fifth review: the largest divergence there was the Cessna climb (+49 % at sea level, +60 % at 8000 ft).
The cause was known: the propeller in the model is a momentum disk with a constant efficiency of 0.85, and the engine at full throttle delivers
full power at any speed. A real fixed-pitch propeller has no set rpm. The rpm settles where
engine torque equals the torque the propeller absorbs. At low speed the propeller is "heavier", rpm is below 2700, and the engine
delivers less power. The rule is the same: the references are only independent 172S POH data (`data/research.md`, part 4.2),
nothing was tuned to fit them.

### What was done in the core

- **`src/core/propeller.ts` (new)** — a blade element propeller model with momentum theory on each annulus: axial
  and tangential induced velocities, Prandtl tip and root losses. At each radius a single equation is solved
  for the inflow angle φ (the Ning 2014 formulation, written for a propeller):
  `Ωr·(sin²φ − σ'·Cn/4F) − V·(sin φ·cos φ + σ'·Ct/4F) = 0`. There is no singularity at V = 0; the root is found by bisection.
  Section coefficients come from the shared `airfoilCoeffs` model (full range of angles, Prandtl–Glauert, compressibility drag rise
  from the sixth review). There is `propellerEquilibrium` — the equilibrium rpm for a given engine torque.
- **`src/core/sim.ts`** — the `propeller` drive has an optional `fixedPitch` block. If it is set, rpm is a state
  variable: `I·dΩ/dt = Q_engine − Q_prop`. Engine torque = throttle × `power/ω_rated` × altitude lapse. Without the block everything
  is as before (a disk with an efficiency — like a constant-speed propeller; projects from `design.ts` are built this way).
  At zero throttle the propeller windmills and brakes the aircraft. `Sample` has `propRpm`, `propEfficiency`.
- **IO-360-L2A engine.** At full throttle torque is constant and power is proportional to rpm. The basis is type certificate
  EASA.IM.E.032 (Issue 03, 2022, sec. 6 "Ratings", full throttle at sea level): 119 kW (160 hp) at 2400 rpm and 134 kW
  (180 hp) at 2700 rpm. That is 474 N·m at both points, to within 0.1 % (`data/research.md`, 4.2, item 7). Below 2400 rpm
  there are no data points; constant torque there is an assumption. New field `powerplant.ratedRpm` = 2700.
- **Flight program (`programs.ts`).** At full throttle in level flight at sea level the fixed-pitch propeller would spin
  the engine up to 3080 rpm. So the program, like a pilot, pulls back the throttle and holds no more than `ratedRpm`: the 2700 redline
  (POH, section 2). Maximum speed is now under this limit, which is how the POH defines its 126 kt. New fields in the flight
  results: `vMaxRpm`, `cruiseRpm`, `cruisePropEfficiency`, `climbRpm`, `climbPropEfficiency`. No other aircraft
  have `fixedPitch`; nothing changed for them.

**McCauley 1A170E/JHA7660 propeller** (`src/presets/cessna172.ts`): 2 blades, D = 76 in (POH), pitch 60 in — from the designation
"7660". McCauley measures pitch at 0.75R. The blade geometry is not published, so everything else is **estimates**.
They were chosen before the first run and not changed after it:

| Quantity | Value | Basis |
| --- | --- | --- |
| pitch distribution | constant along the radius | a common assumption; the real distribution is unknown |
| blade start | 0.2R | hub spinner |
| chord | 0.10 m at the root, 0.125 m at 0.4–0.6R, 0.11 / 0.08 / 0.05 m at 0.8 / 0.95 / 1.0R | forged light-aircraft blade; resulting AF ≈ 80 (typically 80–100) |
| airfoil | Clark Y type: c_l0 0.36 from the flat side (zero lift at −3.6°), slope 5.7/rad, c_l,max 1.3, c_d0 0.008, t/c 0.09 along the whole length | the McCauley airfoil is not published |
| moment of inertia of propeller with crankshaft | 1.5 kg·m² | does not affect steady-state conditions |

### What the checks showed (`validation.ts`, Cessna section)

| What was checked | Reference | Before (disk, efficiency 0.85) | Now | Result (tolerance) |
| --- | --- | --- | --- | --- |
| static rpm at full throttle at sea level | 2300–2400 (POH, sec. 2) | — | 2614 (+11 %) | **divergence** (2.5 %) |
| rpm in the simulation vs. torque equilibrium | verification | — | 2614 / 2614 | passes (0.5 %) |
| power absorbed by the propeller at the speed and rpm of a POH row, relative to that row's %BHP (37 rows) | 1 | — | 0.83 (from −23 to −10 %) | **divergence** (4 %) |
| rpm in cruise flight, 7 rows of Fig. 5-8 | 2100–2550 | — | +0.8…+2.5 %, on average +1.5 % | 5 pass, 2 at 2000 ft — **divergence** +2.2 and +2.5 % (2 %) |
| cruise power, the same 7 rows | %BHP | −4…−9 % | −5.9…−11.1 %, on average −9.4 % | 1 passes, 6 — **divergence** (8 %) |
| maximum speed at sea level, ≤ 2700 rpm | 126 kt | +5.2 % (full throttle, no rpm limit) | 122.8 kt (−2.5 %) | passes (4 %) |
| maximum speed at 8000 ft, ≤ 2700 rpm (2700 rpm row, 77 % — full throttle) | 124 KTAS | — | 120.6 kt (−2.7 %) | passes (4 %) |
| rate of climb at sea level | 730 fpm | 1085 (+49 %) | 862 (+18 %), 2414 rpm, propeller efficiency 0.68 | **divergence** (10 %) |
| rate of climb at 8000 ft | 410 fpm | 657 (+60 %) | 482 (+17 %), 2410 rpm, efficiency 0.71 | **divergence** (10 %) |

The tolerance of each row is spelled out in the code (reference uncertainty: table rounding, wheel fairings, tachometer, power extraction
for the alternator). Cruise rpm is not very sensitive to power error: at J ≈ 0.7 the propeller's C_P falls steeply with J,
and 5 % of power gives about 1 % of rpm. Hence their tolerance is 2 %, not 8 %.

How the compressibility drag rise (sixth review, merged in parallel) affected these numbers: without it static rpm
was 3105, climb — 991 and 588 fpm, absorbed power — −19 %. The blade tips run at M 0.75–0.92, and wave drag
makes the propeller noticeably "heavier". The model uses a single blade thickness, 0.09, while at the tip of a real blade it is about 0.06,
so wave drag at the tip is probably overestimated.

### What this means

- **Climb**: the divergence shrank from +49…+60 % to +17…+18 %. It remains for three reasons, each pushing the same way.
  1. The model propeller is "light": at the same speed and rpm it absorbs 10–23 % less power than the real one,
     most of all at low J. Climb rpm is therefore higher than it would be with the real propeller, and the engine delivers more power.
  2. Propeller efficiency in the climb is 0.68–0.71. Estimates from the POH put the real one at about 0.6–0.65. The model lacks flow blockage by the cowling
     and the increase in fuselage drag in the propeller slipstream.
  3. The model airframe needs less power than the real one: the parasite drag area of 0.36 m² is an estimate.
- **The "light" propeller is probably the geometry.** The blade angle is known only through the 60 in pitch. What it is measured from (the flat
  side or the chord) and where the airfoil's zero lift lies are estimates. At J ≈ 0.7 the sections operate at an angle of attack of about 1°,
  and a 1° error changes absorbed power by about 15 %. For the static case, the sensitivity is printed in the divergence reason:
  with chord ×1.25 (AF 100, also a typical value) it would be 2315 rpm, with c_l,max 1.6 — 2192. I did not change the chord: that would be
  fitting to the number being checked. There is also a sign that it is not only the geometry: the APC 9x4.7 SF propeller, built from
  UIUC **measured** geometry, also falls short on C_T and C_P by 20–26 % in static conditions (the "small propeller" section). Outside the experiment
  I ran the same APC through the new solver: C_T 0.095, C_P 0.036, FM 0.651. The previous model of blades as Rapier bodies
  gave 0.644 — two different implementations agree.
- **Cruise rpm matched the POH within 0.8–2.5 %** — partly because two errors cancel each other.
  The "light" propeller raises rpm, while the airframe needs less power, which lowers it.
- **Cruise power** is now 3 % further below the POH than before. Previously the disk efficiency (0.85 of ideal, about 0.80) happened
  to be close to the real one. Now the isolated model propeller efficiency in cruise is 0.82–0.85: there are no losses from the cowling and from the slipstream on the fuselage.
  So the earlier "on average −6.5 %" partly rested on an underestimated propeller efficiency.
- **Verdicts.** The overloaded Cessna is still "Does not fly". The model's climb is still optimistic, but roughly three times
  less so than before. Maximum speed is now limited by 2700 rpm and has become 7 % lower than before.

### What remains

- Measured geometry of the McCauley 1A170E blade (blade angle and chord along the radius, airfoil) or a wind-tunnel test of this propeller.
  Without them the "lightness" cannot be split between geometry and the section model.
- Stall delay on a rotating blade (Snel, Du–Selig) and gradual stall beyond c_l,max. This affects the static case and low J,
  and the small APC propeller awaits the same corrections.
- Flow blockage ahead of the propeller by the cowling and hub, the increase in fuselage drag in the slipstream.
- Blade thickness along the radius (currently 0.09 along the whole length).
- Propeller reaction torque and gyroscopic moment on the airframe are not modelled, as before.
- A fixed-pitch propeller for projects from the builder (`design.ts`): they still use a disk. An estimate of geometry from diameter and
  power is needed.
- `dist/` has not been rebuilt: Cessna telemetry fingerprints in the browser build will not match Node until it is rebuilt.

## Seventh physics check: dynamic stall — measured NACA 0012 loops and the Beddoes–Leishman vortex (2026-11-12)

```bash
VALIDATE_ONLY=dynstall npm run physics -- --validate   # this section only, about 10 s
VALIDATE_ONLY=flappers npm run physics -- --validate   # SmartBird and Snowbird
npm run check   # full run 2026-11-12: 346 checks — 284 pass, 62 "DIVERGENCE" (25 of them are stall loops), no failures
```

The trigger was Snowbird with its published kinematics (section "Fifth physics check" below): thrust about a third of drag,
even though the real aircraft flew for 19.3 s. The wingtip operates at a kinematic angle of attack of about ±23°, in the
dynamic stall regime, while the model had a simplified Beddoes–Leishman without the dynamic stall vortex.

### Reference: measured loops

McAlister, Pucci, McCroskey, Carr, **NASA TM-84245** (1982), vol. 2: an NACA 0012 airfoil pitches about the ¼ chord,
α = A0 + A1·sin ωt, forces are pressure integrals. The report has no numerical tables, only plots. 15 frames were taken:
at M 0.035 and 0.072 (Re 0.5 and 1.0·10⁶ — like the Snowbird wingtip, Re ≈ 3·10⁵, k ≈ 0.19) and at M 0.3 (Re 3.6·10⁶).
k from 0.024 to 0.25. The summary values printed in the page header (C_L,max and its angle, C_M,min, C_D,max) are taken as is.
The C_L, C_D, C_M loops versus ωt were digitized programmatically from the axis ticks (`data/digitize-tm84245.py`); the digitized
maxima match the printed ones within 0–2 %. Data — `src/cli/dynamic-stall-data.ts`, sources and
URLs — `data/research.md`, section 4.7.

The model under comparison is the same wing as the stand's: a `Sim` part with unsteady flow, the angle set by a channel at every step.
The static polar is not taken from the loops: at M 0.3 c_l,max 1.39 — the static data of the same experiment; at low Re — c_l,max 1.00 (TN 3361,
Re 0.5·10⁶) and 1.19 (TN 1945, Re 1·10⁶). Tolerance follows the experimental accuracy: ±0.03 in C_L,max at M 0.3, "about 5 times"
worse at M 0.035 (vol. 1, p. 13), wall correction 1.5 %, digitization, static data from other tunnels: 6 % at M 0.3, 8 % at
M 0.07, 10 % at M 0.035.

### What the comparison without the vortex showed (as before)

| Frames | Peak C_L | Cycle-mean normal force |
| --- | --- | --- |
| M 0.3, A0 15°, k 0.05–0.15 | −17…−28 %; peak 1.7–3.6° too early | −6…−8 % |
| M 0.035–0.07 | −30…−43 % (1.2–1.7 versus 2.1–2.4) | −15…−36 % |

Experiment: at A0 ≈ 15° and k ≈ 0.1 the peak C_L of 2.1–2.3 hardly depends on Re (0.5–3.6·10⁶), even though the static c_l,max
rises from 1.0 to 1.4. This is the dynamic stall vortex: lift holds and grows beyond static stall
until the leading-edge vortex passes off the trailing edge.

### What was changed in the core

`src/core/aero.ts`, `dynamicStall`: a vortex following the Beddoes–Leishman scheme was added to the pressure lag (Tp) and
separation lag (Tf). The vorticity C_V is the difference between the attached-flow normal force and the force with lagged separation (in the scheme
C_N^C·(1 − K_N)); its increments feed into the vortex normal force with lag Tv while the vortex is over the airfoil
(τ_v ≤ Tvl from stall onset by the criterion). Then the vortex force decays with Tv/2; if stall continues, after Tvl + Tsh
the next vortex begins (Tsh = 2(1 − w)/St). Stall onset is the lagged angle beyond the static stall angle, i.e. C_N1 is
the static stall normal force. The constants are the published ones for NACA 0012, not tuned to the references:
Tp 1.7, Tf 3.0, Tv 6.0 (Leishman & Beddoes; the same numbers are the OpenFAST AeroDyn defaults), Tvl 7.0 (Leishman &
Beddoes 1986 for NACA 0012 at M 0.3; the OpenFAST default is 11), St 0.19. Not introduced: the Tf and Tv corrections by cycle
stage (multipliers 0.25…4 in OpenFAST), the vortex suction force and pitching moment. It acts only on parts
with unsteady flow — that is, flapping wings; propellers, airplanes and helicopters are not affected.

Also checked with Tvl = 11 (OpenFAST): the peak C_L is the same, only the post-peak decay changes.

### What the comparison with the vortex showed

| Frames | Peak C_L | Angle of peak C_L | Mean normal force |
| --- | --- | --- | --- |
| M 0.3, A0 15°, k 0.05–0.15 | −8…−17 % | as in the experiment (±0.7°) | within 1–3 % — **passes** |
| M 0.3, A0 10°, k 0.024 and 0.145 | −6 and −10 % | as in the experiment | 0.4 % (passes) and **+19 %** |
| M 0.035–0.07, A0 15° | −25…−31 % | 1.4–3.4° too early | −9…−17 % (1 of 7 passes) |
| M 0.035, A0 10° (α from 0 to 20°) | −28…−35 % | 0.7–1.3° too early | −22…−28 % |

- The mean C_L,max error over the 15 loops went from 31.5 % → 23.5 %, the RMS of C_L over the cycle 0.41 → 0.34 (the check "the vortex brings the model
  closer to the experiment" — passes).
- **Residual at M 0.3** — the peak is 8–17 % low: beyond stall the force in the model drops toward the Hoerner flat plate faster than for the airfoil,
  and the secondary vortices (the second C_L peak in the experiment) gain almost no strength. In light stall (A0 10°, k 0.145) the model
  overestimates the force on the return stroke by 19 %: in the experiment the flow reattaches more slowly than within Tf = 3 half-chords
  (in the full scheme Tf is increased during reattachment; not introduced here).
- **Residual at low Re** is twice as large. The static stall of NACA 0012 at Re 0.5–1·10⁶ is early (c_l,max 1.0–1.2 —
  the laminar bubble at the nose bursts), while in pitching the airfoil holds attached flow up to 18–20°, as at
  Re 3.6·10⁶. The model starts stall from the static angle. For information: with the high-Re static data (c_l,max 1.39) the low-Re
  loops give C_L,max −20 %, mean C_N −3 % — the mean-force divergence comes almost entirely from the early static stall.
  Substituting a "dynamic" c_l,max into the model in place of the measured static one would be curve-fitting; not done.

### Ornithopters after the change

| | Without vortex | With vortex | Reference |
| --- | --- | --- | --- |
| Snowbird: (drag + peak excess thrust) / drag | 0.33 (−36.0 N) | 0.42 (−31.4 N) | ≈ 0.915 from the record flight — **divergence** remains |
| Snowbird: power in the tunnel without recovery | 431 W | 531 W | 620–680 W by the authors — a calculation, not a measurement |
| SmartBird: shaft power at 4.7 m/s | 5.26 W | 5.25 W | 4.4–5.9 W — passes |
| SmartBird: thrust margin (for information) | 9.0 % of weight | 11.8 % of weight | — |

The Snowbird verdict is still "Does not fly". The vortex closed about a sixth of the thrust gap. According to the loop comparison,
at the Snowbird wingtip Re the model underestimates the mean normal force by 9–28 % (most of all when pitching from 0 to 20°, as at the wingtip) and the peak by 25–35 % — enough to
explain a noticeable part of the remaining gap, but not all of it: the model also underestimates gliding drag by 22 %
(i.e. in flight the real wing needs even more thrust than the model). What else is not accounted for in Snowbird: the bending and twist
of the real spar along the span (the model has a hinge at 6 m and linear twist), the DT-HPO1 airfoil instead of NACA 0012
(the stall constants are for NACA 0012), ground effect on thrust.

### What remains

- Early static stall at low Re: needed is a dynamic stall onset criterion based on nose pressure (C_N1 from
  the experiment rather than the static c_l,max), or a polar in which stall at Re < 1·10⁶ is defined by the bubble. Validate against the same loops.
- Tf corrections during flow reattachment (light stall, frame 9307) and the strength of secondary vortices.
- Constants Tv, Tvl for M < 0.3 were not found; the M 0.3 values are used.
- The primary sources Leishman & Beddoes 1986/1989 were not accessed; T_vl = 7 is taken from a secondary table (Clark's dissertation).

## Sixth physics check: blade-tip compressibility and coaxial rotors (2026-11-12)

A continuation of the fifth check (section below): two hover divergences from measurements — the R22 hovered on 12 % less power
than per the POH, and the Harrington coaxial rotor took 14–26 % more power than in the model. Same rule: the reference is a measurement,
parameters are not tuned to the aircraft being checked. Sources and digitization — `data/research.md`, section 4.6.

`npm run check` (together with work from neighbouring sessions — the Cessna propeller and dynamic stall): 346 checks, 284 pass,
62 "DIVERGENCE", no failures; 63 lines for information.

### Compressibility drag rise (`src/core/aero.ts`)

Previously compressibility in the model changed only the c_l slope (Prandtl–Glauert). Now wave drag per Lock is added to the
attached-flow c_d, with the drag-divergence Mach number in Korn's form:

    M_dd = κ_A − t/c − s·|c_l|,   M_cr = M_dd − (0.1/80)^⅓,   Δc_d = 20·(M − M_cr)⁴ for M > M_cr

The coefficients were taken from a measurement of the airfoil itself, not of a rotor: two-dimensional NACA 0012 in the Langley LTPT tunnel (Carpenter, NACA TN 4357,
fig. 5). M_dd (where dc_d/dM = 0.1) at α = 0, 4, 6, 8° fell on the line 0.800 − 0.31·c_l with a scatter of ±0.02,
i.e. κ_A = 0.92, s = 0.31. Korn's classic s = 0.1 is for airfoils at their design c_l; for a loaded NACA 0012
M_dd drops three times faster (with that s, Korn–Lock at α = 4–8° gave almost no rise where c_d had already doubled in the experiment).
The −t/c term is confirmed by the text of the same report: a blade with an NACA 0015 tip diverges at a c̄_l 0.10 lower than NACA 0012,
and 0.03 of thickness = 0.31 × 0.10.

6-series airfoils behave differently: their nose suction peak is smaller, and M_dd depends weakly on c_l. With the NACA 0012 numbers,
a rotor with the R22 airfoil (NACA 63₂-015, Shivers & Carpenter, NACA TN 3850) got a power rise of +45 % at M_t 0.71,
while in the experiment it was only +4.4 %. Therefore the airfoil got an optional `dragRise` field. For the R22 it holds Korn's original numbers
for 6-series airfoils (κ_A = 0.87, s = 0.1; W. H. Mason, "Some Transonic Aerodynamics", p. 51, and "Configuration Aerodynamics", ch. 7; Mason's text was not accessed, the values are from two secondary accounts) — these are published values,
not tuned ones. By default (all other airfoils) — the NACA 0012 numbers.

### κ_int of coaxial rotors (`src/core/design.ts`): 1.16 → 1.28

Primary source — Leishman and Syal's work (JAHS 2008; derivations and figures are in Syal's master's thesis, UMD 2008,
which is downloadable). There κ_int is the ratio of the induced power of the pair to two isolated rotors at the same disk loading,
i.e. the same definition as in the model. Momentum theory gives 1.281 if the lower rotor is in the fully contracted wake of the upper one:
this is the lowest possible value. If the rotors are in the same plane — 1.414. For both Harrington rotors Leishman and Syal use 1.28.
An independent measurement — Cameron, Karpatne, Sirohi (J. Aircraft 2016): upper rotor +18 %, lower +49 %, 1.33 on average.
The value 1.16 (from a forum) is below the theoretical minimum; it was not found in the primary sources.

### Found and fixed

1. **The coaxial rotor rig assembled the upper rotor incorrectly** (`hoverRig` in `validation.ts`, a bug from the fifth check).
   For the mirrored blade (clockwise rotor) the root was placed on the other side of the axis, and the blade went through the axis. Such a rotor
   produced 4.5 times less thrust. The fifth check compared the experiment against a pair in which mostly one rotor was producing thrust. With the fixed
   rig and the old κ_int = 1.16, Harrington rotor 1 gives −7…−14 % instead of −14…−26 %: at low thrust the rig bug
   was the main cause, at high thrust — κ_int. The helicopter builder (`design.ts`) and the quadcopter preset place the blade
   correctly; the bug did not affect them.
2. **No wave drag** — added (above).
3. **κ_int = 1.16** — replaced with 1.28 (above).

### What the measurements showed

| What was compared | Reference (measurement) | Model | Result |
| --- | --- | --- | --- |
| NACA 0012, M at a c_d rise of 0.002 and of 0.01 (α = 0, 4, 6, 8°) | two-dimensional tunnel test (TN 4357, fig. 5) | at 4–8° within 0–2.5 %; at 0° 3.8 % late | 6 of 8 pass (tolerance 3 %); at α = 0 **divergence**: a single M_dd(c_l) line for all angles |
| Full-scale NACA 0012 rotor: FM_max(M_t)/FM_max(0.28) at M_t 0.62, 0.66, 0.70 | TN 4357, fig. 8 and text: 0.933, 0.907, 0.893 | 0.946, 0.905, 0.850 | at 0.62 and 0.66 pass (tolerance 4 %); at 0.70 **divergence** −4.8 %: at the tip of a real blade the rise is gentler (three-dimensional flow) |
| Harrington coaxial rotor, rotor 1, κ_int = 1.28 | TN 2318, fig. 4 | −3.7 %, −3.8 %, −7.7 % (with 1.16: −6.8, −10.1, −13.6 %) | 2 of 3 pass (tolerance 5 %) |
| Harrington coaxial rotor, rotor 2 (new, independent) | TN 2318, fig. 8 | +8.2 %, +0.8 %, −5.9 % (with 1.16: +3.8, −5.8, −13.8 %) | 2 of 3 pass (tolerance 7 %) |
| Harrington single rotor, rotor 2 | same | −1.2…−4.7 % | passes |
| NACA 63₂-015 rotor (R22 airfoil): power rise at M_t 0.71 versus 0.31, C_T 0.0037 | TN 3850, text: +4.4 % | +7.1 % | passes (tolerance 4 %) |
| Same rotor: C_Q at M_t 0.31, C_T 0.0037 | TN 3850, fig. 2: 2.25·10⁻⁴ (FM ≈ 0.71) | 2.37·10⁻⁴ (+5.5 %) | passes (tolerance 6 %) |
| R22: six OGE hover ceiling points | POH p. 5-10 | −8.7…−13.2 % (was −8.7…−13.3 %) | **divergence** remains: compressibility adds about 1 % |

**R22: compressibility is not the main cause.** According to measurements on a rotor with the same airfoil (TN 3850), the compressibility power rise
at M_t 0.71 is only 4.4 %, and the R22 has M_t 0.60–0.67 (104 % rpm, −20…+40 °C) — even less. In the model it added about
1 % to the R22 (−20 °C: −12.0 → −11.1 %). The model even computes the rotor itself 5 % more expensive than the experiment (the same TN 3850 at low M_t).
So the 11–13 % lies outside blade aerodynamics: the downwash load on the cabin (2–5 % of thrust) is not accounted for; the tail rotor
and transmission share (15 %) is an estimate; interpreting the steep portion of the POH chart as the takeoff 131 BHP is also an estimate. None of these
numbers was tuned to the POH.

While only the 0012 airfoil was being checked, with it the R22 at −20 °C (M_t 0.667) got +18 % power, and at +20 °C — +2 %.
Such a spread is a sign that the 0012 coefficients do not carry over to the 6-series. That is why the separate TN 3850 rotor was needed
as an independent check.

The RMS error of the coaxial pair over six points of the two rotors is 5.6 % with κ_int = 1.28 and 9.9 % with 1.16.
The residual is in the slope: in the experiment the "pair / two isolated rotors" ratio grows with thrust (rotor 1: 1.22 → 1.37,
rotor 2: 1.09 → 1.28), while the model's κ_int is constant. Therefore at low thrust the model overestimates the pair's power, and at high thrust underestimates it.

### What changed for the aircraft

- **Coaxial helicopters** (Ka-26, Ka-32, designs from the builder): the pair's induced power increased by a factor of 1.28/1.16 = 1.10,
  hover power — by about 8 % (Ka-26 design: 473 kW, mutual interference ×1.194 instead of ×1.10). The Ka-32 still
  "Flies" (2310 of 3266 kW).
- **Main rotors at M_t > 0.6** (R22 and any fast rotors): profile power increases at the blade tips.
- **Airplane propellers**: blade tips at M 0.75–0.9 get wave drag (applies to the blade-element propeller
  model; not to the actuator-disk propeller with constant efficiency).
- Airplane wings, ornithopters and small rotors (M < 0.5): unchanged. Δc_d is computed from the stall-limited C_L,
  so there is no spurious rise beyond stall or at low M.

### What remains

- The drag rise beyond M_dd per Lock (fourth power) is gentler than the two-dimensional experiment and steeper than the blade-tip experiment.
  There is no correction for three-dimensional tip flow (because of this FM at M_t 0.70 is 5 % below the experiment).
- There are two airfoil families: NACA 4-digit (the default, from the 0012 tunnel test) and the 6-series (Korn's numbers). For 5-digit
  airfoils (23015 — in TN 3850 it diverges earlier than 63₂-015), low-Reynolds-number airfoils and supercritical airfoils there are no specific numbers.
  The text-description project builder gives all airfoils the default values.
- The R22 is still 9–13 % below the POH. Candidates: the downwash load on the cabin, tail rotor power
  (a measurement or calculation of the R22 tail rotor is needed), the interpretation of the POH chart.
- κ_int is constant, whereas in the experiment mutual interference grows with thrust; Leishman's textbook (PHA) was never accessed.

## Fifth physics check: comparison with real measurements (2026-11-12)

```bash
npm run physics -- --validate   # only the comparisons with measurements, a few minutes
npm run check                   # everything together: 286 checks — 258 pass, 28 "DIVERGENCE", no failures; 23 lines INFO
```

The rule for this check is the user's own words: "tests must not be tuned to pass. Physics must be checked with maximum
realism." The previous four passes compared the model mostly against formulas. Here the references are measurements:
airfoil wind-tunnel tests, propeller and rotor test-stand data, tables from pilot's operating handbooks.
Numbers and source links are in `data/research.md`, part 4. The checks are in `src/cli/validation.ts`.

The checks gained two new outcomes (`src/cli/physics.ts`, `makeReporter`):

- **DIVERGENCE** — the model missed the measurement by more than a tolerance justified by the reference's uncertainty and the known
  simplifications of the model. It is printed with the reason and counted on a separate line in the summary. It does not fail the run, but it is not hidden either.
- **INFO** — the number is printed but does not count as a check. This covers comparisons with a reference that a model
  parameter was tuned to, and comparisons with a quantity that is not a reference.

The tolerance of each comparison is broken down in the code: what it is made of and how much each part contributes. No tolerance
was tuned to the result. Where the budget came out smaller than the discrepancy, the result is "DIVERGENCE", not a widened tolerance.

### What the measurements showed

| What was compared | Reference (measurement) | Model | Result |
| --- | --- | --- | --- |
| NACA 0012 post-stall, normal force at 30, 60, 90, 135° | two wind-tunnel tests: NACA TN 3361 (Re 1.8·10⁶) and SAND80-2114 (Re 0.36–0.7·10⁶) | within 3–10 % | passes |
| same at 45° | C_N 1.63 (mean of two tests) | 1.41 (−14 %) | **divergence**: the Hoerner flat plate post-stall underestimates the force at 30–60° |
| C_D trailing edge first (180°) | 0.014 ± 0.006 | 0.007 | **divergence**, almost no effect on forces |
| Reference airfoils (Cessna NACA 2412, R22 NACA 63-015) | Report 824 at their Reynolds numbers | between the smooth and the rough airfoil | passes: input numbers not tuned |
| Cessna 172S: stall | POH fig. 5-3: 53 KCAS | 27.36 m/s (+0.4 %) | passes (tolerance 5 %) |
| Cessna: engine power vs altitude | POH fig. 5-8: 77 % at 8000 ft, 72 % at 10,000 ft | 75.8 % and 70.4 % | passes (3 %) |
| Cessna: power required, 8 rows of the cruise table at 2000, 8000 and 12,000 ft | POH fig. 5-8 | mean −6.5 % (from −4 to −9.3 %) | 6 rows pass (tolerance 8 %), 2 — **divergence** at the highest speeds |
| Cessna: maximum speed at sea level | 126 kt | +5.2 % | **divergence** (tolerance 4 %): same as cruise — the model needs less power |
| Cessna: rate of climb at sea level and at 8000 ft | POH fig. 5-7: 730 and 410 fpm | 1085 and 657 fpm (+49 %, +60 %) | **divergence**: fixed-pitch propeller not modelled |
| Cessna: pitch moment of inertia | 1480–1825 kg·m² (NASA TM-80163, JSBSim) | 3952 kg·m² | **divergence** ×2.4: fuselage mass is smeared over an ellipsoid |
| Untwisted rotor, 2 and 4 blades (NACA TN 626, tables) | C_Q at the same C_T | from −4 to −11 % | 1 of 6 passes, 5 — **divergence** |
| Full-scale rotor with −8° twist (NACA TN 4357) | C_Q at the same C_T | +2.5…+4.5 % | passes (tolerance 6 %) |
| Harrington single rotor (NACA TN 2318) | C_Q at the same C_T | 0…+7 % | 2 of 3 pass |
| Harrington coaxial rotor | C_Q at the same C_T | −14…−26 % | **divergence**: κ_int = 1.16 underestimates the power of the coaxial pair (sixth check: the upper rotor of the test stand had been assembled incorrectly; with the corrected stand and the old 1.16 — −7…−14 %; now κ_int = 1.28, −4…−8 %) |
| R22: six points of the OGE hover ceiling chart at constant takeoff power | POH p. 5-10 | −8.7…−13 % | **divergence**: the model R22 hovers on 12 % less power |
| Quadcopter rotor at thrust equal to Phantom 4 weight | NASA Ames measurement on a DJI 9450 rotor | +8.7 % | **divergence** (tolerance 8 %) |
| Motor efficiency with ESC | same measurement: 0.73 | 0.75 | passes |
| APC 9x4.7 SF propeller from measured geometry | UIUC, static tests: FM 0.668 | 0.644 (−3.6 %) | passes; C_T and C_P individually 20–26 % lower (INFO) |
| SmartBird: shaft power in level flight at 4.7 m/s | 13 W (electrical, excluding servos) × drive efficiency 0.34–0.45 = 4.4–5.9 W (Send et al., ICAS 2012) | 5.26 W (+2.4 % vs midpoint) | passes |
| Snowbird: drag in gliding at 7.1 m/s | 54.0 N — gliding and towing with a dynamometer (Reichert 2011, table 12.1) | 42.3 N (−22 %) | **divergence**: parasite drag and wing c_d0 are estimates; the authors' values are higher |
| Snowbird: thrust with the published kinematics (0.65 Hz, ±1.0 m, twist ±7°, flapping panels from 6 m) | record flight: total energy constant over 19.3 s, i.e. thrust ≈ drag (corrected for ground effect — 0.915 of free-air drag) | thrust is a third of drag (0.33); with the dynamic-stall vortex — 0.42 | **divergence**: the tip operates at ±23°, and the stall model at low Re underestimates the force (see "Seventh physics check") |


### What this means for the verdicts

- **Cessna.** The model describes steady flight within 4–9 % in power, and stall accurately.
  Climb is strongly overestimated (+50–60 %): in the model the propeller is a disc with a constant efficiency of 0.85, and the engine
  at full throttle delivers full power at any speed. A real fixed-pitch propeller at low speed turns
  below 2700 rpm, with an efficiency of about 0.6. The "Does not fly" verdicts for an overloaded aircraft are therefore optimistic:
  the model may pass an aircraft that in reality will not climb.
- **Rotors in hover.** The model with κ = 1.15 correctly describes a twisted rotor (Carpenter, within 5 %)
  and the Harrington single rotor. For an untwisted rotor and at low Reynolds numbers (TN 626) it underestimates power
  by 4–11 %. For the real R22 the discrepancy is 12 %. Known causes: no compressibility drag rise
  at the blade tip (M 0.62–0.65; for the Carpenter rotor at M 0.7 FM is 10 % lower than at M 0.3), no download
  from the wake on the cabin (2–5 % of thrust), the tail rotor and transmission share of 15 % is an estimate. The model R22 hovers
  where the real one no longer can: its hover ceiling is optimistic by roughly 2000–2500 ft.
- **Coaxial rotors** (outdated — see the sixth check: κ_int = 1.28, and the coaxial rotor test stand had been assembled with an error).
  κ_int = 1.16 was taken from a forum; the primary source was not read. Harrington's experiment shows that a coaxial pair
  takes 1.22–1.37 times more power than two separate rotors at half thrust each, while the model gives about 1.12.
  The hover power of the Ka-26 and Ka-32 in the model is probably underestimated by 10–20 %. The value 1.16 was not changed: there is no reliable
  number to replace it (in Harrington's data the split into profile and induced parts is unstable, rotor 1 is wooden,
  with very low solidity). A comparison with Harrington's second rotor and with the primary source is needed.
- **Post-stall** (the "Dune" ornithopter, blades in reverse flow) the model underestimates aerodynamic forces
  at 30–60° by 10–20 %.
- **Flapping-wing aircraft.** The model describes SmartBird's shaft power within the accuracy of the paper. Snowbird with the real
  kinematics does not stay airborne in the model: thrust is a third of drag, and gliding drag is 22 %
  less than measured. On the real wing the tip operates at ±20–23° — in the dynamic-stall regime, where lift
  is sustained by the leading-edge stall vortex. The model did not have this vortex; it does now, but the discrepancy remains (see "Seventh physics check"). The verdict for large slow
  flapping-wing aircraft ("Does not fly") is therefore pessimistic.

### Found and fixed

1. **Cruise power was taken before the flight condition had settled** (`programs.ts`, flight program). Power was averaged
   over 22–30 s after leaving the maximum speed. The speed controller (0.08 per m/s) was still oscillating by then,
   with a period of about 40 s. At 112 knots at 8000 ft it gave 78 kW instead of the steady-state 76, and at neighbouring speeds
   the curve jumped. Now the cruise controller is damped (0.25 per m/s), and power is taken only when
   for 16 s in a row the speed stays within 0.2 m/s, altitude does not change and throttle does not wander. If it has not settled within 200 s,
   the report says so. The old comparison at 124 knots: was 96.3 kW, now 93.7 kW.
2. **New flight program mode** — steady climb at a given speed at full throttle (`climbSpeed`):
   rate of climb. Needed for the comparison with the POH.
3. **The altitude controller of the "Takeoff and hover" program oscillated at low density.** For the R22 at 1524 m altitude wandered
   by ±3 m with a period of about 9 s, the hover was not counted, and the mean power was biased. The old
   "R22 at 5000 ft" comparison (85.3 kW) relied on this. The inner loop (collective → acceleration) is slower at low density, and the outer one
   was too stiff. The altitude and speed gains of 1.0 and 1.8 were replaced with 0.4 and 1.2. Oscillation for the R22: at sea level
   1.2 → 0.55 m, at 1524 m 6.2 → 1.9 m (hover counted), at 3000 m 3.5 → 1.7 m; for the quadcopter and Ka-26 no worse than before.
   For comparisons with the POH, hover is still computed on a fixed body, with the collective pitch trimmed for thrust equal to weight.
4. **Flapping-wing references switched from tuned numbers to published ones** (`src/presets/flappers.ts`):
   - Snowbird: frequency 0.83 → 0.65 Hz (dissertation, "observed in flight"; 0.83 was a paraphrase of "16 flaps in 19.3 s");
     flap amplitude — by tip travel ±1.0 m instead of the tuned ±4°; twist ±45° → ±7° (structural limit);
     only the panels from 6 m flap, the inner part is fixed — as on the real aircraft (bracing wires at 6 m);
     masses — from the dissertation's mass table (wing 27.6 kg); c_l,max 1.5 → 1.55 (DT-HPO1 airfoil with early transition).
   - SmartBird: drive efficiency 0.6 (estimate) → 0.34 (measured in the same paper).
   **The Snowbird verdict changed: "Flies at the limit" → "Does not fly"** (thrust is a third of drag).
   This is not an input error: the model with the real kinematics does not reproduce the real flight, and the old verdict relied
   on tuned amplitude and twist. SmartBird still "Flies"; electrical power at 5 m/s is 15.7 W
   (per the paper, 23 W at the design condition, of which about 5 W are servos).

### Review of the earlier checks for tuning

Each `npm run check` check was reviewed: what it compares against, where the reference comes from, whether it is independent of the model parameters,
what justifies the tolerance. Checks not related to physics (interface, service, generation, images, links) are not
in the table: their reference is a requirement of the specification, not a measurement.

**Comparisons with reference aircraft (existed before this check):**

| Check | Reference | Source | Independent? | Tolerance was | What was done |
| --- | --- | --- | --- | --- | --- |
| Cessna: stall | V_A/√3.8 = 52.3 KCAS | TCDS, derived from maneuvering speed | yes, but not the stall table | 20 % (spec) | replaced with the POH table 53 KCAS, tolerance 5 % by budget |
| Cessna: maximum speed | 126 kt | POH specification | yes; drag area 0.36 m² is an estimate, not tuned to the reference (visible in the cruise table) | 20 % | tolerance 4 % → **divergence 5.2 %** |
| Cessna: cruise 75 % at 8500 ft | 124 kt | POH specification | yes | 20 % | replaced with eight rows of the cruise table, tolerance 8 % |
| Cessna: maneuver, margin ≥ 1.5 | — | — | **no**: spar cross-section tuned to a margin of 5.7 at 1 g | — | marked "dependent" |
| R22: power at the 5000 ft ceiling | 131 hp | Robinson: "HOGE 5000 ft" | yes | 20 % | replaced with six points of the POH chart, tolerance 5 %; the old measurement was biased by controller oscillation (item 3 above), became INFO |
| R22: coning 2° | — | — | tuned for bending equilibrium in hover | — | physically correct: the real R22 has coning hinges, the blade settles there by itself |
| Quadcopter: 174 W | 81.3 Wh over 28 min | DJI spec sheet | **not a hover reference**: mean power over a flight, not hover, and the battery is not drained to zero | 20 % | INFO; replaced by the rotor against the NASA measurement on the 9450 propeller |
| Quadcopter: blade c_d0 | — | — | it was raised to 0.03 to match the reference, then returned to 0.02 | — | 0.02 kept; the comparison with the NASA measurement shows +8.7 % |
| SmartBird: power 13 W | 18 W minus servos | Send et al., ICAS 2012 | passed with a drive efficiency of 0.6 — an estimate; the same paper measured 0.34 | 40 % (spec) | drive efficiency taken from the paper; comparison moved to the shafts (13 W × 0.34–0.45), tolerance — the efficiency spread in the paper (14 %); electrical — INFO |
| SmartBird: supports weight and thrust | L/D ≈ 7 | same paper | partly: drag tuned to L/D ≈ 7 from the same paper | — | marked |
| Snowbird: power on the power stroke | 600–700 W | pilot's estimate | **no**: flap amplitude tuned to this estimate | 40 % | kinematics taken from the dissertation; power — INFO (there are no in-flight power measurements; the authors' 620–680 W is a calculation) |
| Snowbird: 16 flaps in 19.3 s | record flight | Wikipedia | **no**: frequency 0.83 Hz set as 16/19.3 (and itself wrong: per the dissertation 0.65 Hz) | — | removed; frequency from the dissertation |
| Snowbird: verdict "at the limit" | flight with decreasing energy | Chronister, Flapping Wings | **no**: amplitude tuned, twist ±45° "with margin", the "at the limit" threshold (20 % of drag) set with an eye on the references | — | with the published kinematics the model's verdict is **"Does not fly"**; comparison with the real flight — divergence (see above) |
| Ka-26: power vs hand estimate | momentum theory × 1.15 × 1.16 | the same formulas and numbers as in the model | **verification**, not a comparison with reality | 10 % | renamed |
| Ka-26: interference 8–13 % | κ_int = 1.16 | forum | verification that κ_int is applied | — | renamed; κ_int itself compared with Harrington — divergence |
| Ka-26: "Flies" | — | — | **not for strength**: 9 mm wall tuned to a margin of 1.9 | — | marked |
| Cessna project: stall | V_A/√3.8 | TCDS | yes | 20 % | POH 53 KCAS, tolerance 5 % |

**Formula checks** (`src/cli/physics.ts`: general laws, strength, unsteady aerodynamics, the fourth check;
in `check.ts` — flapping inertia, lifting line, rotor in hover, beam) are verification: the code computes what
is written in the formula. The reference is independent of the model (a formula or a conservation law), the tolerances are the numerical error
of the computation (time step, the engine's single precision, actuator shortfall) or rounding, not "so that it passes". Special cases:

| Group | Reference | Independent? | Tolerance |
| --- | --- | --- | --- |
| Free fall, pendulum, momentum, angular momentum, centrifugal force | laws of mechanics | yes | 2–3 %: time step and the engine's single precision |
| Lifting line, rotor in hover (momentum theory + profile) | formula with the same constants (0.9·πAR, κ = 1.15) as in the model | verification of the implementation; the constants themselves are now compared with experiments | 2 % |
| Strength of materials, buckling, fatigue, atmosphere | formulas and ISA tables | yes | up to rounding |
| Wagner, Theodorsen — Garrick | theory | yes | 1–5 %: discretization |
| Stall delay: "10 % above static", "3° later" | qualitative | the direction is right (dynamic stall), the numbers themselves are not measurements | threshold is arbitrary, marked in the section README |
| Time-step convergence | model with half the time step | comparing the model with itself — by intent (convergence), this is not a comparison with reality | 2–5 % |
| Negative examples (Cessna ×2 mass, wooden blades, "Dune" ornithopter) | qualitative | yes | — |
| SmartBird and "bird" projects: holds altitude and speed, free flight = tunnel | autopilot quality and consistency of programs | not a comparison with reality | arbitrary thresholds (0.1 m, 5 %, 15 %) |

### What remains

- ~~**Fixed-pitch propeller.**~~ — done, see "Cessna 172S fixed-pitch propeller": climb +49…+60 % → +17…+18 %.
  Was: the largest inaccuracy found — the Cessna's climb. For the McCauley 1A170E/JHA7660 the blade geometry
  is not published — the model uses estimates.
- ~~**Compressibility drag rise** at the blade tips~~ — done in the sixth check. According to the measurements it is
  not the main part of the R22 discrepancy (about 1 %).
- ~~**κ_int of coaxial rotors**~~ — done in the sixth check: 1.28, compared with both Harrington rotors.
- ~~**Dynamic-stall vortex**~~ — done, see "Seventh physics check". Was: (full Beddoes — Leishman or a leading-edge stall vortex model) — without it
  Snowbird does not fly. Compare with NACA 0012 dynamic-stall wind-tunnel tests (McAlister et al., NASA TM 84245).
- For the R22 at 4000 m the hover is not counted (power at the limit, the controller oscillates ±1.7 m).
- **Cessna inertia**: split the fuselage mass into engine, cabin and tail.
- Ka-26: open data disagree on the ceilings (OGE 800 m per Jane's as retold by Wikipedia, 640 m in another reference book),
  and there is no rotor chord or rpm — the comparison has not been made.
- Not found: measured hover power of the Phantom 4, DJI 9450 geometry, measured Cessna propeller efficiency,
  NACA 0012 measurement tables over the full 360° range (only charts are available).

## Fourth physics review: independent (2026-11-12)

```bash
npm run physics -- --audit   # only this section's checks, about 30 s
npm run check                # everything together (236 checks as of the fourth review)
```

The core was read anew and compared layer by layer against formulas and data that do not depend on the program.
Earlier checks were not taken on trust: the search was for what they do not catch. The new checks are the
`auditChecks` function in `src/cli/physics.ts` (32 checks) and five checks in `src/cli/check.ts`.

### Found and fixed

| # | Error | Model gave | Should be | Where |
| --- | --- | --- | --- | --- |
| 1 | Loads on an inclined beam (blade coning, wing dihedral) were resolved along the part's axes instead of the beam's axis | wing with 30° dihedral, weight 98.1 N: shear 98.1 N, axial force 0 | shear W·cos Γ = 84.96 N, compression W·sin Γ = 49.05 N | `sim.ts`: `beamAxes` |
| 2 | Rapier 0.14 sums the inertia of the parts of one body with the wrong sign: m·(\|d\|²E + ddᵀ) instead of m·(\|d\|²E − ddᵀ) | two 1 kg masses at ±1 m: I about their axis 4.0 kg·m²; Cessna in pitch 6,725 kg·m² | 0.0 kg·m²; Cessna 3,952 kg·m² | `sim.ts`: `setBodyMass` |
| 3 | The force on an element was taken at the start of the step, and its moment arm at the middle (the blade turns 5–7° per step). It became visible after item 1: a coned blade has a radial component L·sin β | 4° coning changed rotor power by 5.4 % | by an amount of order β² (0.5 %) | `sim.ts`: `dFm` |
| 4 | Box web shear was the mean V/(2ht) instead of the maximum at the neutral axis | flat Ka-32 blade box: 1.163 times too low | τ = V·S/(I·2t) (Zhuravskii) | `strength.ts` |
| 5 | The elastic response had no air: neither flap damping nor added mass | R22 blade damping 0.03, gain near resonance ×4.5 | ζ = 0.226 vs γ/(16ν) = 0.221 from the Lock number; ×2.0 | `sim.ts`: `elasticInfo` |
| 6 | In-plane (lead-lag) bending used the frequency and damping of the flap mode | a flat box is ~10 times stiffer in-plane | its own mode: EI_lag, Southwell K − 1 | `sim.ts`: `measure` |
| 7 | Seat vibration used the magnitude of acceleration \|a − g\|: longitudinal and lateral shaking showed up only at second order | 2 m/s² shaking along the fuselage at 5 Hz: 0.05 m/s² | 1.10 m/s² (2–16 Hz band) | `crew.ts`: `VibrationMeter` |
| 8 | Negative stall −0.8·C_L,max + 2·C_L0 broke symmetry: on a symmetric airfoil (Cessna tail, R22 blades) stall came 20 % early | C_L(−α) ≠ −C_L(α), difference up to 0.53 | C_L,min = 2·C_L0 − C_L,max: exact for a symmetric airfoil and per thin-airfoil theory for a parabolic camber line | `aero.ts` |
| 9 | Atmosphere above 11 km: density froze | 15 km: 0.364 kg/m³; at 20 km four times the real value | ISA: 0.1937 and 0.0880 kg/m³ | `aero.ts`: `atmosphere` |
| 10 | Ornithopter free flight: attitude and heading were held silently | — | the holding moment is measured from the change in the system's angular momentum and is stated in the verdict and the report | `sim.ts`: `holdTorque`, `programs.ts` |

Minor: for a multicopter the builder computed C_T for all rotors at once (`design.ts`); it did not affect the result —
this value is not used for multicopters.

Notes:

- **Item 1 and the Ka-32.** The false "Breaks up" for the Ka-32 from `data/gen-live/ka32.json` was caused not by the unidirectional web
  but by item 1. At 3.8° coning the blade's 297 kN centrifugal force should relieve the shear from thrust (18 kN),
  but the model put the entire thrust into the web. Hence a shear stress of 37.5 MPa against a strength of 40 MPa. Now 2.9 MPa.
  A ±45° laminate web model was not needed for this verdict. The webs are still unidirectional,
  and the shear and buckling estimate for them is conservative.
- **Item 2.** The error is in the engine itself and shows on any body made of several colliders. Now the body's mass,
  centre of mass and inertia tensor are summed in the stand (parallel axis theorem, principal axes by the Jacobi method)
  and passed to Rapier ready-made; a single-part body has nothing to sum — the mass sits on its collider, as before.
  Ornithopters are unaffected: each of their bodies is a single part.
- **Item 5.** Damping is by strips, with the cantilever's first mode shape: ½·ρ·a·c·U·F(k) per metre of span,
  U = Ω·r for a blade and the flow speed for a wing, F(k) is the Theodorsen function. The added mass ρπc²/4
  lowers the first frequency of a light wing: for SmartBird 52.7 → 37.1 Hz. The "close to resonance" warning
  is now issued only if the gain is at least 1.5. The coaxial Ka-26 and Ka-32 have ζ ≈ 0.45 and gain ×1.1–1.2:
  no warning. The R22 has ζ = 0.26 and ×2.0: the warning remains. For a real articulated blade
  (ν = 1, γ/16 ≈ 0.25) this is the same.
- **Item 10.** SmartBird: mean moment 0.005 N·m (moment coefficient 0.003) — a small tail can provide it;
  alternating ±0.29 N·m at the flapping frequency — without holding, the body would rock by about ±14°.
  Snowbird: −8.3 N·m (−0.01) and ±116 N·m, about ±5°. This does not change the verdict (the tail is not modelled),
  but it is stated. It was checked that the moment measured this way matches the hinge moment from Newton–Euler
  (difference 0.034 out of 147 N·m).

### What changed for the vehicles

| Vehicle | Before | After | Why |
| --- | --- | --- | --- |
| Ka-32 (AI design) | "Breaks up": blade web shear, 3.17 s | **"Flies"**: margin 1.71 (compressed flange during spin-up), 2,124 kW of 3,266 kW | item 1 |
| R22 | margin 1.90; "close to resonance, up to 4.5 times" | margin 2.20; "up to 2 times"; hover 81.1 kW (was 80.9), at the ceiling 85.3 kW vs 97.7 (−12.7 %) | items 1, 3, 5 |
| Ka-26 (design) | 438 kW, margin 2.0, resonance warning | 439 kW, margin 1.99, no warning | item 5 |
| Cessna 172S | stall 27.41 m/s; manoeuvre: load factor 3.62, margin 1.82 | 27.36 m/s; 3.65, margin 1.78; maximum speed unchanged (68.19 m/s) | item 2: pitch inertia was 70 % too high |
| SmartBird | thrust margin 8.1 % of weight | 9.0 % of weight; power unchanged (8.78 W vs 13 W, −32 %) | item 8 |
| Snowbird | "Flies at the limit" | same; seat vibration is now visible along the fuselage — 0.92 m/s² ("severe" threshold 1.25) | item 7 |
| Quadcopter | 168.3 W | 168.6 W | — |

The reference verdicts did not change; the verdict of the Ka-32 from the AI design did. Telemetry fingerprints changed,
so reports saved earlier via links will be shown to the viewer recomputed, with a warning.

### What was verified without divergence (or within computational error)

| Layer | Check | Divergence |
| --- | --- | --- |
| Dynamics | Free body and rotor in vacuum: system angular momentum | 3·10⁻⁴ out of 134 kg·m²/s |
| | Body counter-rotates against the rotor: ω = I_rotor·ω_rel/(I_body + I_rotor) | 0.00 % |
| | Drive work from shaft torque (Newton–Euler) = kinetic energy (engine) | 0.11 % |
| | Holding moment (from angular momentum) = hinge moment (Newton–Euler) | 0.02 % of the maximum |
| | Inclined beam under weight: shear, compression, bending; the same wing defined by rotating the part | 0.00 % |
| | 4° coning in vacuum: tension F·cos β, shear F·sin β | 0.00 % |
| Aerodynamics | Polar over the full circle: continuity, symmetry, 90° (C_D = C_D0 + 1.98), 180° | exact |
| | Prandtl–Glauert: lift slope at M 0.5 | 0.00 % |
| | Added mass (quasi-steady and unsteady branches) | 1.6 % (drive amplitude shortfall) |
| Rotors | Coning does not change power (order β²) | 0.01 % |
| | Flap damping — Lock number γ/(16ν) | 2.4 % |
| Strength | Zhuravskii shear, two axes | exact |
| Atmosphere | ISA at 11, 20, 32 km; speed of sound; dp/dh = −ρg at 15 km | up to 0.02 % |
| Crew | Vibration along and across the fuselage treated equally, against the 2–16 Hz band transfer function | 0.00 % |

Verified by reading against theory and sources, no divergences found: rotor momentum theory (Glauert),
Prandtl tip loss B = 1 − √(2C_T)/N, κ = 1.15 and κ_int = 1.16 (Leishman; the coaxial pair in the model —
439 kW vs a hand estimate of 429 kW, 2.2 %), hover pitch θ₀,₇₅ = 6C_T/(σa) + 1.5√(C_T/2), the builder's
coning, the Wagner function (Jones), Beddoes–Leishman constants (1.7 and 3.0), the Theodorsen function table,
the Hoerner plate, isotropic and orthotropic buckling limits, k coefficients per EN 1993-1-5,
the Basquin curve and Goodman correction, the Gagg–Ferrar formula, propeller momentum theory,
metal and composite properties against the sources in `data/research.md`.

### What remains

- The ±45° laminate web has not been introduced: it turned out not to be needed for the Ka-32. The webs are unidirectional — the shear
  and buckling estimate is conservative.
- The Cessna model's pitch inertia of 3,950 kg·m² is about twice the value in open simulator data
  (about 1,800 kg·m²): the masses in the preset are distributed crudely (fuselage ellipsoid). This does
  not affect steady-state regimes; the manoeuvre is slightly slower.
- In-plane bending of the R22 blade is 8.1 Hz at 8.8 revolutions per second. In hover there is no once-per-rev
  excitation, and the verdict does not warn about it.
- Sweep: the beam axes account for it, but the aerodynamics do not follow the independence (sweep) principle. None of the references
  and none of the builder's designs have sweep.
- Not verified against a formula: flapping-wing thrust under pure section pitching (Garrick for plunging — only for flapping),
  a rotor in forward flight (the programs do not test this), the dynamic stall vortex.
- The Southwell coefficient of 1.17 was taken from memory; for a uniform cantilever the literature gives about 1.19
  (a frequency difference of about 1 %).
- The ornithopter's heading and attitude are still held perfectly; this is no longer silent, but the model has no tail.

## Page freezes on heavy vehicles (2026-11-11)

Complaint: "I increased the number of main rotors — and everything froze." There were four causes; all are fixed.

1. **Frame computation was not time-limited.** Twelve rotors means 37 bodies; 0.05 s of model time
   took 0.5 s to compute. After a slow frame the page asked to compute even more (the time step grows
   with the delay), and the display went into a "spin": half-second frames, buttons not responding.
   Now computation gets no more than 20 ms per frame. A heavy vehicle runs slower than the selected pace,
   and the line under the picture says so: "computation cannot keep up… display is running N times slower than selected".
   "To result" also computes in time-based chunks rather than in 0.02 s of model time.
2. **The sliders for the number of rotors, blades, wings and seats were fractional** — one could set 4.04 rotors
   (the builder turned this into five hubs, two of them almost at the same point). Now the step is 1 with integer limits,
   and a fractional value from an old link is rejected with an explanation.
3. **Nothing prevented placing rotors so that their discs overlap.** Multicopter rotors are placed
   in a circle, with 2·L·sin(π/N) between adjacent axes; if this is less than the diameter (with a 5 % tolerance), the design
   is rejected: "12 rotors of radius 0.12 m on a 0.35 m arm do not fit… Increase the arm or reduce the radius".

Measured on the page, with 0.05 s of model time requested per frame: before (twelve rotors) a frame took 0.5 s;
now (eight rotors) — 23–27 ms, computing as much as fits. At a 10× slowdown such a
vehicle keeps up fully (14 ms per frame).

4. **"Freeze" after a rejected design** (second complaint, a coaxial Ka-52 with the rotor-count slider at 4).
   The page was not frozen: the design with four rotors on one axis was rejected, there was no model, and the stand showed
   the frozen picture of the previous vehicle, said "Ready to launch", and "Launch" did nothing. The reason was only
   at the bottom of the assumptions screen. Now the stand removes the picture, says "Model not built" with the reason and a
   "← To assumptions" button, and "Launch" and "To result" are disabled. The message is clearer: "4 rotors on one axis cannot be built —
   only a coaxial pair is arranged that way… Three or more rotors are placed in a circle: set the arm to at least the radius".
   The arm slider for a coaxial helicopter was empty (value 0, limits "3 times smaller and larger" — also 0);
   now zero assumptions get a range up to three rotor radii (for the arm) or up to 1.

What remains: computation of heavy vehicles itself has not been sped up — eight to twelve rotors run 5–10 times
slower than real time, and "To result" takes minutes for them. The page stays responsive meanwhile.

## Coaxial helicopter and a test on a real AI (2026-11-11)

### Coaxial layout

A helicopter design with two rotors and zero arm (`rotor.rotorCount = 2`, `rotor.armLength = 0`)
is built as coaxial (`src/core/design.ts`): two hubs on a common axis, separated vertically by 0.2 radius;
the rotors counter-rotate and are controlled by collective pitch. Previously such a design was rejected: "rotors overlap".

Coaxial rotors interfere with each other — the lower one works in the wake of the upper one. The induced power of the pair is higher than
that of two identical isolated rotors by a factor of κ_int. In the model κ_int = 1.16 (from measurements; simple momentum
theory gives 1.28–1.41; sources in `data/research.md`). With 1.28 the hover power would be about 7 % higher.

The Ka-26 reference design (`src/presets/designs.ts`; rotor span, mass and power from open data;
chord, rpm, blade mass and spar web are estimates): "Flies", hover 438 kW of 478 kW,
safety margin 2.0. The hand estimate of power is 429 kW (2 % divergence). Rotor interference
adds 10 % to hover power.

### Three descriptions sent to a real AI

Through the page, as a user does. Cost — $0.42 (0.17 + 0.18 + 0.07), 26–29 s per vehicle.
The designs are saved in `data/gen-live` and are part of the check suite (without calling the AI).

| Description | What the AI built | Verdict |
| --- | --- | --- |
| "Robot seagull: flaps two wings and flies forward like a bird. Span 2 m, mass 0.5 kg, 2 flaps per second" | "bird": speed 10 m/s, flap amplitude 40°, web 0.5 mm, 25 W | "Flies": 8 s, 80.3 m, 14 W of 25 W, safety margin 3.0 |
| "Ornithopter from 'Dune', 8 wings, crew of 6" | "dragonfly" (speed 0): 8 wings of 11 m each, 15 Hz, 12 t, 6 MW | "Breaks up" at 0.007 s |
| "Ka-32 helicopter" | coaxial layout: two three-blade rotors of radius 7.95 m, arm 0, 3.27 MW | "Breaks up": blade web shear at 3.17 s — see "Unresolved" |

The AI correctly distinguished a "bird" from a "dragonfly" and, from the name alone, built the Ka-32 as coaxial on its own.

### What the live test found

None of these errors were caught by the checks without the AI.

1. **Generation from a description did not work at all.** With two new fields the design schema became too large:
   the AI responded with the error "compiled grammar is too large". The schema was simplified: coaxiality is determined by the number of rotors
   and zero arm, without a separate field; wing mass "compute from material" is 0 instead of `null`.
2. **The wind-tunnel autopilot could not balance lift against weight on a fast vehicle.** For the "seagull" at 10 m/s
   lift changes by 0.49 of weight per degree, while the autopilot allowed a slope of no more than 0.25 (tuned for
   SmartBird and Snowbird) and oscillated between two angles. A stalled regime was chosen, power came out
   at 86 W, and the wing "broke". Now the slope is taken from lifting-line theory, and once angles with a lift deficit
   and a lift excess are found, the angle is searched between them. SmartBird did not change; Snowbird shifted
   within 1.5 % (in the tunnel 866 W without energy recovery and 314 W with recovery instead of 868 and 316).
3. **After breakage the computation diverged**: the Mach number of the debris reached 10¹⁹. For a detached light part
   the added air mass is larger than its own, and computation from the previous step's acceleration is unstable.
   Now added mass is not computed for debris, the Mach number is taken only over intact parts,
   and free flight is terminated after breakage.
4. **The "bird" spar was wider than that of the references** and previously lost stability. Now the section is the same
   as for SmartBird and Snowbird.
5. **The Ka-32 blade "broke" on the ground under its own weight** (at 0.017 s): it was treated as a hollow
   thin-walled box. Rotor blades have honeycomb or foam filler behind the spar, and the walls are stiffened.
   The structure gained a `structure.filled` flag: local buckling is not checked for such a section;
   the other failure modes are checked as usual. It is set on the blades of helicopters built
   from a description and on the R22 reference (its result did not change).
6. **An old builder error**: for a clockwise-rotating rotor with three or more blades, the blade
   rotation angle went past 360°, and the design was rejected. This also affected multicopters with three-blade rotors.

### Unresolved

The first two items were resolved by the fourth physics review (section "Fourth physics review" above): the shear came from
resolving loads along the part's axes instead of the axis of the coned blade; the resonance warning came from the absence
of aerodynamic flap damping. The text below is left as originally written.

- **The AI-built Ka-32 gets "Breaks up", and this is an error of the model, not of the vehicle.** Without strength taken into account
  it hovers: 2,119 kW of 3,266 kW. The blade breaks by web shear (margin about 1). The spar web
  is treated as unidirectional fibreglass, whose shear strength is 40 MPa; in real blades
  shear is carried by ±45° plies. A laminate web model is needed — it will also make buckling more accurate.
  The Ka-26 reference has enough margin only with a 9 mm web.
- **The "close to resonance" warning on blades.** The first flap frequency of a blade rigidly fixed
  in the hub is always about 1.1 per rev; in real blades flapping is strongly damped by the air, while the model has
  3 % damping.
- The Ka-32 fuselage looks bloated on the page: the AI wrote the height of the helicopter with rotors (5.4 m) into the fuselage height.

## Ornithopter free flight (2026-11-11)

> The Snowbird numbers in this and the following sections predate the fifth physics check. With the kinematics from Reichert's thesis
> (0.65 Hz, tip stroke ±1.0 m, twist ±7°) the Snowbird model does not stay in the air — see "Fifth physics check".

```bash
npm run stand -- smartbird free    # trim search in the stream, then free flight
npm run report -- snowbird free
```

The new `free` program is "Ornithopter free flight" (`src/core/programs.ts`). On the page it is
the default for SmartBird and Snowbird.

1. **Trim search** — the same wind-tunnel autopilot: the body is fixed in the oncoming flow, and the wing
   incidence and twist are tuned. On the page this part runs accelerated (1–5 s).
2. **Release.** The oncoming flow is converted into the vehicle's velocity: velocity V is added to every body,
   and to the wind as well (`Sim.boost`). The flow around the vehicle does not change. The body is released: forward
   and vertical motion are free, heading and body pitch are held.
3. **Flight** — 16 flaps, but no less than 8 s. Once per flap the autopilot corrects the wing incidence
   (altitude) and the twist (speed).

How the autopilot works. A wing damps its own sink: as it descends, it meets the flow at a higher angle.
So over a flap what settles is not an acceleration but a sink rate proportional to the deviation of the incidence
from the trim value: v_y = V·Δθ. On each flap the autopilot refines the trim incidence
and adds a correction that removes 35% of the altitude error per flap. Speed is handled the same way, through
twist. The first version of the autopilot assumed the angle sets acceleration and held neither altitude
nor speed: SmartBird lost 0.43 m and 5% of its speed in 8 s.

The measure of flight is total energy (altitude + V²/2g): its loss over the distance flown equals the thrust deficit.
A loss above 20% of drag is "Does not fly", 5 to 20% is "Flies at the limit". Power
is compared with the available power the same way as in the wind tunnel.

Results:

| | SmartBird | Snowbird | Snowbird record flight |
| --- | --- | --- | --- |
| Verdict | "Flies" | "Flies at the limit" (power suffices only with energy recovery) | — |
| Flight | 8 s, 16 flaps, 39.8 m | 19.3 s, 16 flaps, 136 m | 19.3 s, 16 flaps, 145 m |
| Altitude relative to start | −0.024 to +0.028 m | 0 to +0.063 m | — |
| Speed | 4.79…5.02 m/s with 5 commanded | 6.94…7.13 m/s with 7.1 commanded | 7.1 m/s average |
| Power (in wind tunnel) | 8.96 W (8.80 W) | 844 W without recovery (866 W) | 600–700 W on the power stroke (model: 575 W) |

Checks (`npm run check`, section "Ornithopter free flight"):

| Check | Result |
| --- | --- |
| Body in a 5 m/s flow vs body moving at 5 m/s through still air: lift and power per flap | agree to the fifth digit |
| No spurious load-factor jerk on release | deviation from 1 g — 0.000 |
| Newton's law: body velocity over a flap changes by the impulse of external forces | discrepancy up to 0.0012 m/s for impulses up to 0.22 m/s |
| SmartBird with four times the body drag | "Does not fly": speed dropped to 2.4 m/s in 3.6 s, flight aborted |

What free flight showed. A free body is jerked by the flapping — fore-aft and up-down.
For SmartBird at the same settings this changes lift by 4–6%, and thrust decreases:
the autopilot had to reduce twist from 81 to 63–66% of maximum. The thrust margin in flight is therefore
smaller than the wind tunnel shows.

Unmanned vehicles. In free flight the SmartBird body shakes: 3.1 m/s² in the 2–16 Hz band, which would be
dangerous for a human. Previously the body was fixed and the question did not arise. The specification now has a
`crew.unmanned` flag (SmartBird, the quadcopter, designs with zero seats): load factors of such vehicles are shown
in the report for information and do not affect the verdict.

Limitations:

- Heading, roll and body pitch are held perfectly: the tail surfaces and lateral motion are not modelled.
  Since 2026-11-12 the moment used to hold the body is measured and named in the verdict (see "Fourth physics check").
- The start is straight in the air at cruise speed (hand launch, tow). There is no takeoff run or climb.
- The drive is kinematic: the wings flap at the commanded frequency under any load. Power is computed
  but does not limit the motion.
- Ground effect is not taken into account. The real Snowbird flew a metre above the ground, where induced drag is lower.
- 16 flaps is a short flight: over 70 flaps the regime is also stable for both vehicles (checked manually),
  but this is not part of the check suite.

## Ornithopter from a description: "bird" or "dragonfly" (2026-11-11)

Previously an ornithopter built from a description or picture was always built as a hovering vehicle — with no trim
control. It could not get into the wind tunnel or free flight: the program answered "Not applicable".

Now the design that the AI fills in has a `flapping.cruiseSpeed` field (`src/core/design.ts`):

- **Forward flight speed set — "bird".** The builder constructs the vehicle the same way as the SmartBird
  and Snowbird references: the wing works in the oncoming flow, the mean incidence is the trim control, and on the stroke
  the wing twists towards the tip. Maximum twist is taken with a 20% margin above the flow angle
  at the tip, arctan(tip speed / flight speed), within 15–60°. On the page such a vehicle
  opens directly in the "Ornithopter free flight" program.
- **Speed 0 — "dragonfly".** The vehicle hovers in place, like the ornithopter from "Dune": everything as before.
- **Old links do not have the field** — such a design is built as a "dragonfly", exactly as before (this is checked).

Checked without calling the AI on the reference design "robot seagull" (SmartBird numbers, `src/presets/designs.ts`):
it builds, and in free flight it gets "Flies": 8 s, 16 flaps, 40.2 m, speed 4.99 m/s with 5 commanded,
power 8.68 W out of 50 W.

Caveats:

- With the real AI this was checked on two descriptions (section above): it distinguished "bird" and "dragonfly" correctly.
  Two descriptions are not statistics.
- If the AI does not specify the wing mass, it is computed from the spar and skin. For a "bird" the skin is assumed light —
  1 kg/m² per metre of chord. The same design without a specified mass comes out at 0.67 kg instead of 0.48 kg
  and does not stay up in free flight: speed drops to 3.1 m/s in 2.3 s.

## Ornithopters on the stand: what a person sees (2026-11-11)

The calculation gave SmartBird "Flies" and Snowbird "Flies at the limit", but on the page both looked unable to fly:

1. The wind-tunnel autopilot goes through 60–110 flap cycles: 30 s of model time for SmartBird, 135 s for Snowbird.
   The stand showed this slowed down 10 times — 5 and 22 minutes — and the whole time displayed
   "So far: Does not fly: lift 0% of weight".
2. The vehicle in the wind tunnel is fixed, the flow was not visible, and the picture froze after the test.
3. In the "Takeoff and hover" and "Tethered stand" programs both got "Does not fly", and the program for airplanes
   referred to hover.

What was changed (`src/web/main.ts`, `src/web/recorder.ts`, `src/core/analyze.ts`, `src/core/programs.ts`):

- The wind tunnel is computed accelerated immediately on the "Start" button: verdict in 1–5 s. Then the flight regime found is played
  in a loop at the selected slow-motion rate (the last whole flap from the frame recording). The flow is visible — streaks carried
  past the vehicle — along with the ground grid receding backwards.
- Until the test ends, a verdict is issued only on what has already happened (breakup, crew overload).
  Otherwise the stand displays "Test in progress" rather than "So far: Does not fly".
- An ornithopter for forward flight (cruise speed set) gets "Does not hover" in the hover programs,
  with an explanation and a pointer to the forward-flight program; the program for airplanes points there too.
- Looped replay of the last cycle is also enabled after the tethered stand and the limit regime — there the body
  is fixed as well.

Ornithopter free flight appeared later — see the section above.

## Strength check (2026-11-11)

```bash
npm run physics -- --strength   # strength checks only, a few seconds
```

The strength calculation (`src/core/strength.ts`, `src/core/section.ts`, loads — `src/core/sim.ts`) was verified
against strength-of-materials formulas on individual sections and on a wing in a flow: 25 checks, all pass.

| What was verified | Discrepancy |
| --- | --- |
| Box area and moment of inertia, bending stress, torsion (Bredt), shear, equivalent stress (von Mises), margin | to rounding |
| Critical wall stress: compression, flapwise bending, in-plane (chordwise) bending | to rounding |
| Tube: bending in two planes | to rounding |
| Fatigue: Basquin curve, Goodman correction | up to 0.1% |
| Wing in steady flow: root stresses from lift and drag | 0.5% |
| Elastic wing near resonance (drive at half the natural frequency): stress range × 1.33 | 0.2% |

Four bugs were found and fixed:

1. **Composite walls buckled "like metal".** The critical stress was computed with the formula for an
   isotropic plate using the longitudinal modulus. In a composite the wall is also held by the transverse modulus, which is several times
   lower. Now the plate stiffness is B = √(Q₁₁·Q₂₂) + Q₁₂ + 2·Q₆₆, σ_cr = k/4 · π²t²/(6w²) · B.
   For unidirectional carbon fibre (135 / 10 / 5 GPa) B = 50 GPa instead of 297 GPa — 5.9 times less.
   For metal the formula reduces to the previous one. The transverse modulus and shear modulus were added to the library
   for the carbon fibres, glass fibre, aramid and spruce; where no data exist, they are taken from a generic carbon fibre
   and marked as estimates.
2. **One critical stress for the whole section.** The lower of two was taken (flange in compression, web in
   flapwise bending) and compared with the highest compression at any corner. Now each of the four box walls
   is checked separately: its own width, its own stress distribution, coefficient k from 4 (uniform compression)
   to 23.9 (bending in the plane of the wall) per EN 1993-1-5, Table 4.1.
3. **For the tube, bending in two planes was added arithmetically** — the stress was overestimated by up to √2 times.
   Now it uses the resultant moment.
4. **Fatigue was computed only for the upper flange**, without in-plane bending. Now it uses the worst
   of the four corners of the section.

What changed for the vehicles:

| Vehicle | Margin was | Margin now | Verdict |
| --- | --- | --- | --- |
| Ornithopter from "Dune" | 0.003 | 0.001 | "Breaks up"; material needs to be ~2,640 times stiffer (was ~640) |
| Cessna 172S (aluminium) | 5.7; 1.82 in the limit regime | unchanged | "Flies" |
| R22 (aluminium) | 1.9 | 1.9 | "Flies" |
| Festo SmartBird | ~27 | 6.5 | "Flies" |
| UTIAS Snowbird | 4.9 | 1.02 → check removed | "Flies at the limit" (on power, as before) |

The Snowbird spar in the model was a guess: a unidirectional carbon-fibre box with a 4 mm wall.
It would weigh 43 kg per wing — as much as the whole vehicle. The design of the real spar has not been published,
and its wing is supported by drive cables, which are not in the model. Fitting the guess to the answer would be dishonest,
so the Snowbird's structural members were removed: strength is not checked, and this is stated in the vehicle's description.

Along the way a report flaw was found: the warning "Strength not checked" was printed only with the verdict
"Flies". Now it appears with any verdict, and the report telemetry has the line "Strength margin: not checked".

Caveats:

- Walls are treated as unidirectional, fibres along the span. Real spars have ±45° plies
  in the webs, which are more stable. For a library material the estimate is correct; for a real structure it is conservative.
- Not computed: shear buckling of the walls, composite delamination, global buckling of the wing,
  stress concentration at the attachment fittings.
- Fatigue is computed only for materials with data (metals); there are no data for composites.

## Unsteady flow over a flapping wing (2026-11-11)

```bash
npm run physics -- --unsteady   # unsteady-model checks only, a few seconds
```

For a surface with `aero.unsteady: true` (SmartBird and Snowbird) lift is computed with flow memory
(`src/core/aero.ts`, `src/core/sim.ts`):

1. **Lift lag** — the Wagner function in Jones's approximation,
   φ(s) = 1 − 0.165·e^(−0.0455·s) − 0.335·e^(−0.3·s), s — distance in semichords. The angle of attack is taken from the downwash
   at the ¾-chord point (including the section's pitch rate). The force is perpendicular to the *effective*
   flow: when it lags, it is tilted backwards and the stroke thrust is lower.
2. **Stall lag** — a simplified Beddoes–Leishman model (trailing-edge separation): two first-order lags,
   Tp = 1.7 and Tf = 3.0 semichords. The constants are taken from the literature for the NACA 0012 airfoil
   and were not tuned. With a rapid increase in angle, lift exceeds the static maximum.
3. **Added mass** — both from flapping and from the section's rotation in the flow.

Comparison with theory:

| Check | Computed | Theory | Discrepancy |
| --- | --- | --- | --- |
| Step in angle of attack: force immediately after | 0.530 of steady-state | φ ≈ 0.5 (Wagner) | 0.2% from formula |
| Same after 9.7 semichords | 0.878 | φ(s) | 0.2% |
| Plunge, k = 0.094: thrust / quasi-steady | 0.725 | F² + G² = 0.735 (Garrick) | 1.4% |
| Plunge, k = 0.283: thrust / quasi-steady | 0.504 | 0.489 | 3.0% |
| Plunge, k = 0.283: power / quasi-steady | 0.681 | F = 0.676 (Theodorsen) | 0.8% |
| Slow increase of angle through stall | static polar | — | up to 0.8% |
| Rapid increase of angle (25° in 0.15 s) | C_L up to 1.38 with static maximum 1.2; stall at 20° instead of 12° | — | qualitative |

Stall lag has been verified only qualitatively and in the slow-change limit: there is no formula for it,
and there is no wind-tunnel data in the repository.

What this gave for the reference ornithopters (the "wind tunnel" program):

| | Quasi-steady | Lift lag only | Lift and stall (current) | Reality |
| --- | --- | --- | --- | --- |
| SmartBird, thrust margin at 5 m/s | +5.8% of weight | −3.4% of weight | **+8.6% of weight** | flies |
| SmartBird, flapping power at 4.7 m/s | 10.7 W | — | **8.8 W** | 13 W |
| Snowbird, verdict | at the limit (±3°) | does not fly at any stroke amplitude | **at the limit (±4°)** | at the limit |

Lift lag alone halves the thrust, and in the model neither of the two real
ornithopters flies: both operate near stall, and without stall lag the model systematically underestimates thrust.
With both effects both fly.

Caveats:

- Snowbird's stroke amplitude has not been published and is tuned so that the work per flap matches the pilot's estimate
  (600–700 W on the power stroke). With the new model this is ±4° (628 W) instead of ±3°; the twist limit has been raised
  to ±45° — above the flow angle at the tip.
- SmartBird's power is now 32% below the published figure (was 17%): within the spec tolerance (40%), but worse.
- The flow "remembers" the past, so after each settings change the wind-tunnel autopilot skips a flap cycle
  and shifts the controls smoothly. The trim search takes 60–110 cycles (for Snowbird, 137 s of model
  time, 3–4 s of computation).
- Not taken into account: the dynamic-stall vortex, loss of leading-edge suction on thin airfoils at low Reynolds
  numbers, spanwise unsteadiness. The verdict warns about this.
- The ornithopter from "Dune" and vehicles built from a description are still computed quasi-steadily:
  they flap in place, without oncoming flow, and the wing is in deep stall.

## Physics verification (2026-11-11)

```bash
npm run physics   # only the checks against general laws, about 2 minutes
npm run check     # everything together (236 checks as of 2026-11-12), all pass
```

The core was re-read from scratch and checked against laws that do not depend on the program (`src/cli/physics.ts`):

| Check | Computed | Formula | Discrepancy |
| --- | --- | --- | --- |
| Free fall, distance in 2 s | 19.63 m | g·t²/2 | 0.03 % |
| Terminal fall velocity | 17.90 m/s | √(2mg / ρ·C_D·S) | 0.01 % |
| Load factor in the seat: falling / on the ground | 0.000 g / 1.000 g | 0 / 1 | — |
| Pendulum, 90° swing: period | 2.360 s | 4·K(sin 45°)·√(2L/3g) | 0.3 % |
| Pendulum: energy loss over three periods | 1.96 % | 0 | numerical damping, ~0.7 % per period |
| Centrifugal force at the blade root | 14.21 kN | ω²·Σm·r | 0.00 % |
| Thrust of a flapping wing in a flow | 1.634 N | ¼·ρ·c·a·θ₀²·ω²·R³/3 (Garrick at F = 1) | 1.9 % |
| Flapping energy balance: shaft power | 32.65 W | thrust × flow velocity | 0.07 % |
| Wing without drag at an angle | thrust 0 | d'Alembert's paradox | exact |
| Symmetry: ornithopter side force | 1·10⁻¹⁰ N out of 1.7·10⁷ N | 0 | — |
| Half the time step: ornithopter, R22, Cessna | — | same result | 0.01–1.7 % |

What was found and fixed:

1. **The wind-tunnel autopilot got stuck.** Thrust depends non-monotonically on wing twist: too little and the wing stalls,
   too much and it "feathers" and produces no thrust. The old controller turned the twist "in one direction only", considered balance reached
   with a thrust shortfall of up to 1 % of weight (while the verdict required strictly ≥ 0), and did not allow the incidence angle above the stall angle.
   Because of this SmartBird "did not hold its weight" and Snowbird "did not pull". Now the twist is swept over the whole
   range, lift is balanced by the secant method, the T = D regime is searched for on the unstalled branch, and strength
   and peaks are computed only at the regime found (parts do not break during the search trials).
2. **Flapping power was overstated by a factor of two.** It was computed as a sum of absolute values: braking the wing cost as much
   as accelerating it. An actuator that brakes a part spends no energy. Now there are two quantities: without recovery of
   braking energy (sum of the positive parts over the actuators) and with full recovery (signed average over whole
   cycles — the work done on the air). For the "Dune" ornithopter these are 7,630 and 2,890 MW instead of 12,400 MW. The label
   "with full recovery" was previously attached to a number that was not that.
3. **Averages over an incomplete cycle.** Power and lift were averaged over windows of 1 s and 0.5 s — for slow
   flapping (Snowbird, 0.83 Hz) that is not a whole cycle. Now the windows are multiples of the cycle.
4. **Snowbird data were guesses even though they are published** (`data/research.md`): wing area 29.2 m²
   (was 39 m² "so that it holds its weight"), flight mass 114.3 kg, 16 flaps in 19.3 s = 0.83 Hz (was 0.6),
   pilot power 600–700 W on the power stroke (was 300 W). With the real area the aircraft flies at
   C_L = 1.24 — right at the stall.
5. **SmartBird drag** was tuned to the published lift-to-drag ratio L/D ≈ 7 (was ~10).

What came out after the fixes:

These are results of the quasi-steady model; after accounting for unsteadiness the numbers are different — see the section above.

- **SmartBird — "Flies"**: thrust margin 2–6 % of weight, 10.7 W for flapping without energy recovery (6.8 W with recovery)
  versus 13 W per the paper (level flight at 4.7 m/s without servos; 18 W with them): −17 %.
- **Snowbird — "Flies at the limit"**, as the spec requires: thrust is short by 3.8 N (9 % of drag, 0.34 % of weight),
  power suffices only with energy recovery (309 W; without recovery 700 W against 650 W). In the record of the real
  flight total energy and speed were also slowly decreasing. Caveat: the flapping amplitude is not published and was chosen
  (±3°) so that the work per flap matches the pilot's estimate; the power check is therefore not independent.

New verdict rules for flapping flight:

- A thrust shortfall of less than 20 % of drag (the spec's tolerance for reference aircraft) is "at the limit", not "does not fly":
  the model does not know drag more precisely than that.
- If power suffices only with recovery of the wings' braking energy — "at the limit" with an explanation;
  if it is insufficient even with recovery — "does not fly".
- Unsteadiness warning: at a reduced frequency k ≥ 0.1 the steady-flow model overstates
  flapping thrust — by Theodorsen–Garrick theory for an airfoil, by a factor of 2.1–2.2 at k ≈ 0.3. For SmartBird and Snowbird
  unsteadiness is now taken into account (section above); the warning remains for surfaces without `unsteady`.

Known numerical errors (not fixed, covered by checks):

- The velocity-driven actuator falls short of the amplitude by about 1 % at 120 steps per cycle and by about 3 % in power at 40
  steps per cycle (ornithopter); it goes away as the time step decreases.
- The engine computes in single precision: the centre of mass of an ornithopter in vacuum drifts by 5.6 mm in 3.5 s with a
  fuselage travel of ±515 mm (1 %); the error grows as the time step decreases — this is rounding, not integration.

## Stage 6: publication

```bash
cp .env.example .env        # AI key, monitoring password, salt, limits
npm run build               # build the page into dist/
npm run serve               # the whole service: page, API, storage — http://localhost:8139
```

The service is a single Node process (`src/server/server.ts` → `src/server/app.ts`):

- **Reports via permanent links.** "Get link" in a report saves the test state and a snapshot of the report
  on the server (verdict, reasons, telemetry, thinned-out charts — about 20 KB) and returns a short
  link `/r/<number>`. No registration; on a phone the report is shown immediately from the snapshot.
  The snapshot is sent by the author's browser, so it is not taken on trust: the viewer's page re-runs the test in a background thread
  and compares the telemetry fingerprint — "result matches" or a recomputed report with
  a warning. The server validates both the state (like a link from the AI) and the snapshot (schema, sizes).
  If the server is unavailable, a long link with the test embedded right in the address (`#r=…`) remains.
- **Clip** (the "Clip 12 s" button in a report): the test is recomputed, frames are captured at the required moments
  of model time and played at exactly 30 per second into MediaRecorder — 960×540, MP4 (or WebM
  where MP4 is not supported), about 2 MB. With a breakup: 3 s of run-up, 5 s of the slowed-down moment of breakup with a marker,
  4 s of the verdict card; without a breakup — the whole test in 8 s plus the card. The clip is downloaded as a file;
  it is not stored on the server.
- **AI generation limits:** per browser (anonymous cookie, no registration) 10 per hour and 40 per day,
  per address 30 per hour, total daily budget $10. When exceeded — a message saying how long to wait and that examples
  and editing assumptions are free. Rejected requests never reach the AI. Everything is configured in `.env`.
- **Cost monitoring** — the `/admin` page (password `ADMIN_TOKEN`; disabled without it): costs today
  and in total against the daily budget, generations by day (successful, with an image, time), errors over the week,
  the last 50 generations, saved reports and their views. The log contains no description text or images,
  the address is stored only as a salted hash.
- **Two languages** — Russian and English. A switch at the top of the panel, `?lang=en`, otherwise the browser language.
  Everything the user sees is translated: the interface, the verdict and the report (phrases as pairs `tr('…', '…')`
  in `src/core`), names of aircraft, parts, assumptions and materials (dictionary `src/core/i18n-data.ts`).
  The AI answers in the interface language. A report saved in one language is shown to a viewer in another
  recomputed in the viewer's language (the telemetry fingerprint does not depend on the language).
  Still in Russian only: specification validation messages on error, command-line output, `/admin`.
- **Example gallery** — six reference aircraft on the "Input" screen (since stage 4); they do not call the AI.
- **Storage** — the SQLite built into Node, a single file (`DB_PATH`, default `var/stand.db`).
  The spec calls for PostgreSQL and object storage: for a single node this is unnecessary, and clips and images are
  not stored on the server at all. If it grows — move the `reports` and `generations` tables to PostgreSQL.
- **Security:** CSP headers (own origin only, `wasm-unsafe-eval` for Rapier), framing forbidden,
  nosniff; escaping the `dist/` folder is blocked; the AI key lives only on the server and only from `.env`/the environment.
- **Deployment:** `Dockerfile` — a single container, data on the `/data` volume, port 8080, health
  check `/api/health`, `TRUST_PROXY=1` (behind a reverse proxy with HTTPS).

Found along the way:
- Without `ANTHROPIC_API_KEY` the SDK picked up credentials from the user profile (fixed in stage 5).
- Node does not go through `HTTPS_PROXY` on its own — the AI client now goes through the proxy if one is set.

Stage 6 acceptance:

| Criterion | How verified | Result |
| --- | --- | --- |
| A report link opens without registration on a computer and a phone | Local production build (`npm run serve`), built-in browser, widths 1400 and 375 px; a Russian link was also opened in English | done locally: report shown immediately, the viewer's recomputation in 1.7 s matched |
| Exceeding a limit gives a clear message; costs are visible in monitoring | `npm run check`: per-browser limit, daily budget (ru/en), requests do not reach the AI, `/admin` without a password is closed, costs in monitoring | done |
| All checks of section 12 pass on the deployed service | — | **not done**: the service is not deployed (hosting is needed). Locally, after the physics verification, all checks of section 12 pass |

Not verified: the `Dockerfile` was not built — Docker Desktop is not running on this computer. Frame rate,
Firefox and Safari — as in stage 4. The clip was checked in Chromium (MP4); it was not run in Safari or Firefox.


## Stage 5: generation from an image

```bash
npm run make-image-cases   # draw the test set: data/image-cases/*.png and data/image-cases.json
npm run image-eval         # run the set through the real AI — needs ANTHROPIC_API_KEY, costs money (~$2)
```

Scenario B: on the "Input" screen an image can be dragged in, pasted from the clipboard, or chosen as a file
(JPEG, PNG, WebP up to 10 MB), optionally with a clarification added as text.

- **In the browser** the image is checked (whether it opens, at least 64 px), downscaled to 1568 px
  on the long side and re-encoded as JPEG. Metadata (shooting coordinates, etc.) is stripped in the process.
  The image goes only to the AI: it is not saved on the server or written to the log, and it does not end up in the report or the link.
- **On the server** (`src/server/image.ts`) the type is determined by the file signature, not by the declared one;
  dimensions are read from the PNG, JPEG (SOF marker) or WebP (VP8, VP8L, VP8X) header. Rejected: not an image,
  type does not match the declared one, smaller than 64 px, larger than 8000 px or more than 5 MB.
- **The AI** (`src/server/generate.ts`) receives the image in both requests. In the analysis it fills in the
  `image` block: view, **scale reference** (a dimension line or a labelled grid, a person 1.8 m, a car 4.5 m,
  a door 2 m, recognisable equipment, a size from the text, or "none"), number of wings, rotors and propellers,
  blades, measured dimensions and what is not visible. In the design, dimensions from the image carry `origin: "image"`
  and the named reference. An image without an aircraft is rejected with an explanation.
  Text in the image is treated as data; the AI does not follow instructions in it.
- **On the assumptions screen** there is a "From image" block: view, scale reference, what was computed, what was measured, what was estimated.
  Assumptions from the image are labelled "From image: …".

The test set is 15 images (`src/tools/image-cases.ts`, drawn by `src/tools/draw.ts`): 13 aircraft
(airplanes with 1, 2 and 4 propellers, helicopters with 2, 3 and 5 blades, multicopters with 4, 6 and 8 rotors, ornithopters
with 1 and 4 pairs of wings) in top, side and front views, in three styles (drawing, silhouette, blueprint), with a scale
reference (person, dimension line, grid) and without one; plus a chair and a house with a tree. The drawings are made to
given dimensions, so the ground truth is exact, and there are no third-party images in the set. These are drawings, not
photographs: on photos with perspective the AI errs more often, and this set does not test that.

Stage 5 acceptance:

| Criterion | How it is checked | Result |
| --- | --- | --- |
| ≥ 12 of 15 images — correct class and number of wings or rotors | `npm run image-eval` | **14 of 15** — done |
| Proportions of the main parts — within 25 % of the ground truth | `npm run image-eval`: span/length, chord/span, propeller diameter/cabin length, arm/radius, wing length/fuselage length | **15 of 15**, largest deviation 8 % — done |
| An image without a vehicle is rejected with an explanation | `npm run image-eval` (chair, house) and `npm run check` with a mock AI | both rejected with a description of what is in the picture — done |

Run on Claude Opus 5.5, 2026-11-11 (results in `data/image-eval-last.json`):

- The AI chose the scale reference correctly in all cases: dimension line, grid, human figure; where there is no
  reference, it said so and estimated from the aircraft type. Absolute dimensions with a reference are within 5 %.
- One miss: an ornithopter drawn from the front, captioned "Human-powered aircraft", was assembled by the AI as a propeller airplane,
  modelled on Daedalus and Gossamer Albatross. From the front a flapping wing cannot be distinguished from a fixed one, and
  human-powered aircraft are most often airplanes, so this is more a poor case in the set than an AI error.
  The ground truth was not changed to fit the result.
- **Generation time.** First run: 32–59 s against the spec requirement of "no longer than 30 s". A per-step timing
  showed that the slow cases went through a correction round: the AI put non-numeric fields into the assumptions
  (material, highWing), validation rejected the design, and a repeat request of 17–19 s followed. Now such entries
  are discarded before validation (`normalizeDesign`), and the design step runs with effort low instead of medium
  (~2,200 output tokens instead of ~3,100). Second run: **23–31 s**, no correction rounds, same
  accuracy (14 of 15, proportions 15 of 15). 2 cases of 15 did not fit in 30 s — 30 and 31 s; the run went
  with 4 requests at a time.
- Cost: first run $2.01, second $1.46 ($0.08–0.18 per image).
- Found and fixed: a network error was counted as "rejected with an explanation"; the rejection explanation
  repeated the phrase "There is no aircraft in the image" twice.
- Node, unlike curl, does not read the HTTPS_PROXY variable. The AI client (`src/server/client.ts`) now
  goes through the proxy if one is set: this is needed behind a corporate proxy and in an isolated environment.

Without calling the AI, `npm run check` verifies: PNG/JPEG/WebP headers, rejections (spoofed type, not
an image, 20×20, more than 5 MB), that the image goes as the first block in both requests, the "no aircraft"
rejection, and the ground-truth scoring itself (an exact design passes, an extra blade and radius +43 % do not).

Found during verification: without `ANTHROPIC_API_KEY` the SDK found credentials in the user profile on its own
(`%APPDATA%\Anthropic\credentials`) and tried to use them. Now the server and the evaluation scripts create
the client only with an explicitly set key; a credentials error gives the response "AI key not accepted" instead of a 500.

## Stage 4: interface and report

```bash
npm run dev                                          # stand: the four screens of scenario A
npm run report -- ornithopter tethered --influence   # the same report on the command line
```

The four screens follow scenario A (spec, section 8):

1. **Input** — a description for the AI or an example from the gallery (six reference vehicles and everything built from a description).
2. **Assumptions** — a summary (mass, power, crew, center of mass), sliders: least reliable first,
   each with a confidence label and a rationale, "↺ original" on changed ones and "restore all original estimates".
   Material and altitude are here too. The model is rebuilt without calling the AI.
3. **Stand** — the program and its conditions (cruise, flow speed), run/pause, "To result" (finish computing without
   slow motion), slow motion down to 1/100, camera: follow / free / cockpit, force vectors (lift,
   thrust, drag, weight, smoothed over the drive period), a safety-margin map, a marker at the point of first
   failure, **failure replay** (0.8 s before and 0.5 s after, at no less than 400 frames per second of model time).
4. **Report** — the verdict and the time of the decisive event, up to three causes with numbers and limits, reference points
   (power compared with engines, load factor compared with a fighter pilot), warnings about the limits of the
   model, the three assumptions with the strongest influence on the outcome, the inverse problem, charts (safety margin,
   lift / weight, power), a telemetry table with limits, all test assumptions and a disclaimer
   that the results are estimates. Telemetry is exported to CSV (at least 20 points per drive period).

Structure:

- `src/core/report.ts` — the report as a pure function of the test result: identical in the browser and in Node.
- `src/core/sensitivity.ts` — influence of assumptions: each in turn +10 %, a run without failure,
  comparing safety margin, fraction of required power and lift. For the ornithopter — 8 runs in ~20 s.
- `src/web/worker.ts` — the influence of assumptions and the inverse problem are computed in a background thread, so the page does not freeze.
- `src/core/vehicle.ts` — the test as portable state. The **link** "Copy link" carries all of it
  (after `#`), including the AI-generated design: the test is replayed in the browser of whoever opens it,
  without a server. State from a link is validated the same way as an AI response. Permanent short links with storage
  and a video clip — stage 6.

Stage 4 acceptance:

| Criterion | How it was checked | Result |
| --- | --- | --- |
| Every number in the verdict text is present in the telemetry | `npm run check`: 9 tests, causes + warnings + event time | done |
| The verdict for one specification matches across browsers | 6 reference tests in Node 22 and Chromium 152 (the app's built-in browser) | verdicts matched; numbers differ in the 15th–16th digit, the 12-digit fingerprint matched. Firefox and Safari not checked |
| Three people with no hints complete scenario A within 2 minutes | requires real people | not checked; I walked through the scenario myself, see below |

Scenario A for the ornithopter in the built-in browser: gallery card → assumptions screen (model and summary
immediately on the scene) → "To stand →" → "Run" (the wings break at 0.465 s of model time, visible at 10×
slow motion) → "Report →". That is five clicks; finishing the 5 s test takes ~2 s, the influence of assumptions arrives
in the report after ~20 s from the background thread. A `#r=…` link opens the stand, computes the test by itself
and shows the report.

Cross-environment check: in the page console `__stand.repro()` — 6 reference tests with verdicts
and fingerprints; `npm run check` prints the Node fingerprints for comparison.

Not done or not checked in stage 4:

- Frame rate not measured: the browser pane was hidden during the check, and the page ran as a background page.
- Firefox and Safari were not run. The last bits of numbers differ between JS engines; the verdicts
  on the tests checked do not change because of it.
- Side-by-side comparison of two reports (scenario D), video clip, permanent short links, English
  interface — in the spec these are in stage 6 or outside the scope of stage 4.
- Force vectors are decomposed in a simplified way: lift is the vertical component of the total aerodynamics,
  thrust and drag are the along-heading components, summed over parts with their own sign.

## Stage 3: flapping wings, elasticity, inverse problem

```bash
npm run stand -- snowbird free                   # ornithopter in free flight
npm run stand -- snowbird tunnel                 # ornithopter in a wind tunnel
npm run stand -- smartbird tunnel --wind 6
npm run stand -- ornithopter tethered --inverse  # what it takes to make it work
```

- **The `tunnel` program**: the vehicle is fixed in altitude and heading, and a flow at cruise speed blows on it
  (`limits.cruiseSpeed` or `--wind`). The autopilot sweeps wing twist, for each one balances
  lift against weight with the incidence angle, finds the "thrust = drag" condition and measures three cycles at it
  (details in the "Physics check" section).
- **Ornithopter references** (`src/presets/flappers.ts`): Festo SmartBird (0.48 kg, 13–23 W) and UTIAS
  Snowbird (human-powered aircraft of 2010, 600–700 W on the power stroke). The wing has sinusoidal twist, linear along the span.
- **Wing elasticity**: first natural bending frequency of the cantilever
  f₁ = (1.875²/2π)·√(EI/(μL⁴)), for blades — with centrifugal stiffening (Southwell). Loads are passed
  through a first-mode resonator (3 % damping), and the larger of the elastic and rigid responses is taken.
  If the drive is faster than f₁, the verdict warns: the rigid-wing model is not applicable.
- **Inverse problem** (`src/core/inverse.ts`, the "Solve inverse problem" button on the stand): a run without
  failure → how many times stronger and stiffer the material must be at the same density (margins are proportional
  to strength or modulus), a verification run with that material (up to two refinements), required power
  (without recovering the wing acceleration energy and with full recovery), which library materials would work,
  and what material cannot fix (supersonic flow, resonance, lack of lift, thrust < drag).

### "Dune" ornithopter (result)

Verdict — "Breaks up": spar wall buckling, margin 0.001. Inverse problem (7–10 s):
it needs a material ~2,640 times stronger and stiffer than unidirectional carbon fiber — no such material exists even among
theoretical ones: buckling is governed by the elastic modulus, and for graphene and nanotubes it is higher than
carbon fiber's only by ~7 times. A check with such a material
gives a margin of 1.5, but the vehicle still "Does not fly": it needs ~7,630 MW (2,890 MW with full recovery
of wing deceleration energy) against 5 MW. Material cannot fix it: the wingtips reach M 1.8, the 20 Hz drive is 9 times faster than
the wing's natural frequency (2.2 Hz).

## Stage 2: building from a description

```bash
# key — in the .env file (template .env.example) or in an environment variable; it never reaches the browser
npm run api                    # generation server, port 8139
npm run dev                    # stand; /api is proxied to the server
npm run gen-eval               # check on 20 descriptions — calls the AI, costs money
```

How it works (`src/server/generate.ts`, `src/core/design.ts`):

1. **Analysis** (Claude Opus 5.5, effort low): whether it is an aircraft, its class, parts, what the user specified, what is known about the real machine or from a primary source.
2. **Design** (effort medium): the AI fills in a compact "vehicle design" following a strict schema — dimensions, masses, material, power and a list of assumptions. It does not place part coordinates.
3. **The builder** lays out parts, joints, actuators and controls — the same way the reference presets are built. Blade coning and initial propeller pitch are computed, not guessed.
4. **Validation** of the design and the specification; on violations, the list is returned to the AI for correction, no more than twice.

On the stand, the assumption sliders edit the design and the specification is rebuilt. A fallback model on failure is enabled
(`fallbacks: "default"`). The user's description is data only: the AI does not follow instructions inside it.
Limit — 30 generations per hour per address; editing assumptions and running tests are free.

A vehicle is described by a specification (JSON following the schema in `src/core/spec.ts`); the stand builds
a physical model from it, runs it through a test program and issues a verdict according to the rules of the spec.

## Running

```bash
npm install
npm run dev          # stand page: http://localhost:8137
npm run check        # core check: formulas, references, negative examples
npm run stand -- cessna172 flight                       # test from the command line
npm run stand -- cessna172 flight --altitude 2438 --cruise 63.8
npm run stand -- r22 hover --material spruce
npm run stand -- ornithopter tethered --set "actuators[flap].freqHz=2"
npm run typecheck
```

Vehicles: `ornithopter`, `cessna172`, `r22`, `quadcopter`, `smartbird`, `snowbird` or a path to your own JSON.
Programs: `tethered` (tethered stand), `hover` (takeoff and 10 s hover), `flight` (takeoff roll,
flight, slowdown to stall), `tunnel` (flapping wings in a flow), `free` (free flight of an ornithopter), `max` (limit condition; for an airplane — a maneuver at the design load factor).

## What is computed

| Layer | Model |
| --- | --- |
| Dynamics | Rapier: rigidly connected parts are welded into one body, revolute joints are separate bodies; actuators are velocity-driven |
| Aerodynamics | Per section: the full range of angles of attack (stall, reverse flow), Prandtl–Glauert correction up to M 0.7; wing — induced downwash from lifting-line theory; rotor — momentum theory with dynamic inflow and tip losses; added air mass for flapping wings; airplane propeller — actuator disk momentum theory |
| Strength | At stations along the span: tension and compression separately, local buckling of each box wall (for composites — with the transverse modulus), shear and torsion (Bredt formula), yielding of metals, fatigue at the worst corner of the section (Basquin + Goodman) |
| Crew | Acceleration at each seat: sustained load factor, impact, vibration in the 2–16 Hz band |
| Power | At joint shafts from torque and speed, transmission and tail rotor losses, piston engine power lapse with altitude |

## Materials

24 materials in five groups (`src/core/materials.ts`): metals, composites, natural, dry fibers without
matrix, laboratory and theoretical (nanotube fiber and bundles, the single-nanotube limit,
graphene, metallic glass). Values and references — `data/research.md` (compiled 2026-11-10, only
from open pages). Gaps in the sources are filled by standard rules and listed
for each material in `estimates`; the page shows them next to the material.

## Validation against references

Since 2026-11-12, references are validated against real measurements — the table, tolerances and discrepancies are in the
"Fifth physics check" section at the beginning of the file (`npm run physics -- --validate`). The former table in this section compared
against the spec's 20–40 % tolerances, and some of its rows were dependent (the Snowbird flapping amplitude was fitted to the pilot's estimate,
the frequency — to "16 flaps in 19.3 s", the quadcopter power — averaged over the flight rather than hover).

## What was found during validation and how it was fixed

- **Rapier's position motor** corrects the angle bypassing velocities — accelerations cannot be computed from it. Actuators are velocity-driven.
- **Rapier's fixed joint is compliant**: blades on it lagged behind the hub, and the centrifugal force produced a spurious shaft torque (rotor power was overestimated 17 times). Rigidly connected parts are now a single body.
- **Acceleration from the velocity difference refers to the middle of the step**: force moment arms are taken at the same point.
- **Rotor induced inflow** was recomputed instantly and oscillated every other step — now with a lag, as in the Pitt–Peters model.
- **Rigid ground contact** kills velocity in a single step and produces a spurious acceleration spike. For failure, loads are smoothed to a frequency 5 times above the main drive (no lower than 30 Hz).
- **Uniform induced inflow** underestimated R22 power by 21 %. The standard inflow non-uniformity correction κ = 1.15 was introduced (the rotor's `inducedFactor` parameter).

## Tuning you should know about

Full breakdown — the "Review of previous checks for tuning" table in the "Fifth physics check" section.

- The Cessna spar cross-section is chosen so that the margin at 1 g is about 5.8 (the normal-category ultimate load factor is 5.7) — the wing structure is not in open data.
- The Ka-26 blade spar wall (9 mm) is chosen to give a margin of about 1.9; the Ka-26 strength verdict is dependent.
- SmartBird drag is fitted to the L/D ≈ 7 from the Festo paper; the SmartBird thrust margin is therefore not a check.
- Removed from tuning (2026-11-12): Snowbird flapping amplitude and twist (now from Reichert's thesis), SmartBird drive efficiency (now from the measurement in the paper).
- R22 blade coning (2°) is chosen so that centrifugal force balances the bending from thrust in hover.
- Quadcopter blade drag was temporarily raised to 0.03 before the κ correction existed; now it is the original estimate of 0.02.

## Crew thresholds

Sustained load factor: severe from 2.5 g, dangerous from 4 g, incapacitation (loss of consciousness without protection) from 6 g — NASA OCHMO-TB-024.
Impact: low risk up to 15.2 g (Brinkley model), light-aircraft seat certification limit 26 g. Lethal levels are not given in open
primary sources. Vibration (ISO 2631-1): severe from 1.25 m/s², dangerous from 3 m/s²; our vibration is not weighted with the Wk filter.

## Flapping-wing power

Two quantities are computed. Without energy recovery: the sum of the positive parts of power over the actuators — the actuator
pays for accelerating the wing and for work against the air, while deceleration is free. With full recovery: the signed average
over whole cycles — an elastic wing or a spring returns the energy, leaving only the work done on the air.
The "Does not fly" verdict is issued if power is insufficient even with recovery; if it is sufficient only with recovery —
"at the limit". The no-recovery quantity also includes work against the steady lift on the downstroke: in
real ornithopters it is carried by wing elasticity.

## Limitations

- Airplane lateral motion is not modeled: in the flight program the fuselage moves in the vertical plane.
- Wing downwash at the horizontal stabilizer is not accounted for: the airplane is more stable than the real one.
- Rotor blades are welded to the hub (the R22 teetering hub is not modeled); root bending is partly relieved by coning.
- Wheels and skids have no shock absorbers.
- The wing is a rigid beam with a correction for the first bending mode; higher modes, flutter and bending–aerodynamics coupling are not computed.
- A flapping wing in forward flight (SmartBird, Snowbird) — with lift and stall lag; the dynamic stall vortex is not accounted for. Flapping in place (the "Dune" ornithopter) — quasi-steady.
- Strength: spar walls are unidirectional, without ±45° plies; shear buckling, delamination and attachment joints are not computed. Snowbird strength is not checked (see "Strength check").
- Above M 0.7 sections are flagged "outside the model".
