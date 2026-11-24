# Stress / limit test programmes for light aeroplanes (C172S) and light helicopters (R22): requirements and numbers

Compiled 2026-11-24 from primary texts (14 CFR Part 23 before Amdt 23-64, Part 27, FAA AC 23-8C and AC 27-1B, C172S POH and
EASA TCDS IM.A.051, R22 POH, Robinson Safety Notices, SFAR 73, FAA Helicopter Flying Handbook ch. 11). Every number is quoted
from a source unless marked **DERIVED** (computed from quoted numbers) or **ILLUSTRATIVE** (depends on a stated assumption).
**NOT FOUND** means no consulted source gives the value. CS-23 / CS-27 values were not checked.

Tags: **[S]** structural design condition (analysis / load test, not flown); **[F]** flight-test demonstration; **[S+F]** both.

## A. Normal-category aeroplane (Part 23 pre-Amdt 64; C172S)

### A.1 Limit vs ultimate — what "pass" means
- Ultimate = **1.5 × limit** (§23.303).
- At limit load: no detrimental permanent deformation (§23.305(a)).
- At ultimate load: no failure for **≥ 3 s** (static tests; not for dynamic tests) (§23.305(b)).
- C172S POH p. 2-11: design load factors are 150 % of the limits.

### A.2 Manoeuvring loads and V-n [S]
- Positive limit n ≥ 2.1 + 24,000/(W + 10,000), need not exceed **3.8** (normal); 4.4 utility; 6.0 acrobatic (§23.337(a)).
- Negative ≥ **0.4 × positive** (§23.337(b)); −n at VC, linear to **0 at VD** (normal) (§23.333(b)).
- Flaps: +2.0 g at VF (§23.345). **C172S: +3.8 / −1.52 g** flaps up, **+3.0 g** flaps down (normal, 2,550 lb); utility (2,200 lb)
  +4.4 / −1.76 g (POH p. 2-11).

### A.3 Design speeds (C172S)
| Speed | Rule | C172S |
|---|---|---|
| VC | ≥ 33√(W/S) kt | DERIVED 126.3 kt (= VNO 126 KCAS) |
| VD | ≥ 1.4 VC,min (normal); VNE ≤ 0.9 VD | NOT FOUND; DERIVED **≈ 178 KEAS** |
| VA | ≥ VS√n | **105 / 98 / 90 KIAS** at 2,550 / 2,200 / 1,900 lb (102 / 95 / 88 KCAS) |
| VNE / VNO | §23.1505 | **163 KIAS (160 KCAS) / 129 KIAS (126 KCAS)** |
| VO | abrupt control use prohibited above | 105 KIAS (normal), 98 (utility) |
| VFE | | 110 KIAS (10°), 85 KIAS (full) |
| Stall, 2,550 lb, aft c.g., power off (KIAS/KCAS) | POH fig. 5-3 | flaps up 48/53 (0°), 52/57 (30°), 57/63 (45°), 68/75 (60° bank); full flap 40/48 … 57/68; altitude loss up to 230 ft |

### A.4 Gust loads [S]
- **±50 ft/s at VC**, **±25 ft/s at VD** (SL–20,000 ft) (§23.333(c)); ±25 ft/s at VF with flaps (§23.345).
- Shape **U = (Ude/2)(1 − cos(2πs/25C))**, C = mean geometric chord.
- **n = 1 ± Kg·Ude·V·a/(498·W/S)** (V in KEAS, W/S in psf), **Kg = 0.88µg/(5.3 + µg)**, **µg = 2(W/S)/(ρ·C·a·g)** (§23.341(c)).
- ILLUSTRATIVE C172S (SL, C = 4.82 ft, a = 4.96/rad): µg 16.0, Kg 0.661 → **+3.83 / −1.83 at VC**, +3.00 / −1.00 at VD: the gust case is
  critical at VC.

### A.5 Unsymmetrical, checked and control-surface conditions [S]
- Rolling: 100 % semispan airload on one side, 75 % on the other (§23.349(a)); with aileron at n ≥ 2/3 n_limit (C172S 2.53 g, DERIVED),
  torsion Δcm = −0.01·δ (§23.349(b)).
- Aileron (§23.455): sudden full aileron at VA; at VC the same roll rate; at VD ≥ 1/3 of it. C172S throws: aileron up 20°/down 15°,
  elevator up 28°/down 23°, flaps 0–30° (TCDS).
- **Checked pitch (§23.423):** sudden full aft then forward stick at VA; above VA nose-up at n = 1 with α̇ = +39·n_m/V·(n_m − 1.5),
  nose-down at n = n_m with α̇ = −39·n_m/V·(n_m − 1.5) (rad/s², V in kt). DERIVED for 3.8 g: ±3.25 rad/s² at 105 kt, ±1.92 at 178 kt.
- **Yaw (§23.351 → §23.441):** up to VA, sudden full rudder from zero yaw; overswing 1.5 × static sideslip; 15° yaw with rudder neutral.
- Limit pilot forces (§23.397): aileron stick 67 lb, elevator stick 167 / wheel 200 lb, rudder 200 lb.

### A.6 Crew loads [S]
- Occupant static ultimate: up 3.0 g, forward 9.0 g, side 1.5 g (§23.561).
- Dynamic seat tests (§23.562): Δv 31 ft/s, 60° pitch, 19 g within 0.05 s; Δv 42 ft/s, 10° yaw, 26 g within 0.05 s; HIC ≤ 1,000,
  lumbar ≤ 1,500 lb, strap ≤ 1,750 lb.

### A.7 Flight demonstrations [F]
| Test | Procedure | Pass |
|---|---|---|
| Dive to VD (§23.251, AC 23-8C) [S+F] | trim at MCP, dive in increments to VD, critical c.g.; repeat at VFE with flaps | no damaging vibration / buffet; VNE ≤ 0.9 × max speed shown |
| Flutter (§23.629) [S+F] | excite up to VD; analysis to 1.2 VD | "proper margin of damping" (number NOT FOUND); no rapid damping loss near VD |
| High-speed upset (§23.253) | 3 s acceleration past VMO; 0.5 g for 5 s, recover at ≤ 1.5 g | do not exceed VD or limits |
| Wings-level stall (§23.201) | from ≥ VS + 10 kt decelerate ≤ 1 kt/s; hold ≥ 2 s on the stop; flaps all; idle and 75 % MCP; trim 1.5 VS1 | roll/yaw ≤ 15°; no power until 1.2 VS1 |
| Turning stall (§23.203) | 30° bank, ≤ 1 kt/s | bank ≤ 60° with / 30° against the turn |
| Accelerated turning stall | 30° bank, 3–5 kt/s | ≤ 90° / 60°; n ≤ limit; V ≤ VNE |
| Stall warning (§23.207) | | ≥ 5 kt before the stall |
| Spin, normal category (§23.221) | full up elevator + full rudder at the break; 1 turn or 3 s; standard recovery; abuse cases | recovery ≤ 1 extra turn (≤ 2 for abuse); no exceedance of limit speed / +n |
| Wind-up turn (§23.155) | constant speed, increasing g; 75 % MCP | stick force to n_limit ≥ W/100 (C172S 25.5 lb wheel), need not exceed 50 lb |
| Static stability (§§23.173/175) | 85–115 % of trim; cruise ±max(15 %, 40 kt) | free return within ±10 % |
| Dynamic stability (§23.181, AC) | doublet; phugoid release at ±15 % speed | Dutch roll to 1/10 amplitude in 7 cycles; phugoid time-to-double > 55 s |
| Roll (§23.157) | 30° → 30° bank | ≤ 5 s (take-off) / ≤ 4 s (approach) |
| Trim runaway (AC 23-8C) | recognition delay 1 s (TO/approach/landing) or 3 s (climb/cruise/descent) | loads within 0 to +2 g |

C172S POH: utility-category spins approved, recovery within 1/4 turn for 1–2 turns; allow ≥ 1,000 ft for a one-turn spin.

## B. Rotorcraft (Part 27; R22)

### B.1 Structural conditions [S]
- Factor of safety 1.5; ultimate held ≥ 3 s (§§27.303, 27.305).
- **Limit manoeuvre n: +3.5 / −1.0** (or ≥ +2.0 / ≤ −0.5 if exceeding them is shown extremely remote by analysis and flight test)
  (§27.337). R22 design value NOT FOUND.
- **Gust: 30 ft/s vertical** at each critical speed including hover; AC: hover to **1.11 VNE (= VD)** (§27.341).
- **Yaw (§27.351):** hover to 0.6 VNE sudden full pedal (or 130 lb) to sideslip or 90°, then neutral; 0.6 VNE to VNE cap 15°, linear;
  AC: "suddenly" = ≤ 0.2 s; structural only.
- Pilot forces: pedals 130 lb, stick 100 lb fore/aft, 67 lb lateral (§27.397).
- Occupants static ultimate: up 4, forward 16, side 8, down 20, rear 1.5 g (§27.561). Seat tests: Δv 30 ft/s down, 60° pitch,
  30 g in 0.031 s; Δv 42 ft/s forward, 10° yaw, 18.4 g in 0.071 s (§27.562).

### B.2 Rotor rpm
- Power-off limits: max ≤ 95 % of min(design max, test max); min ≥ 105 % of max(test min, design min) (§27.1509); low-rpm aural warning
  required (§27.33(e)).
- **R22:** power on 101–104 % (515–530 rpm); power off 90–110 % (459–561 rpm); horn and light at ≤ 97 %; below 80 % engine rpm about half
  the tail-rotor thrust is lost (SN-34).

### B.3 VNE
- R22: **102 KIAS** to 3,000 ft DA; max DA 14,000 ft; weight 920–1,370 lb. Beta II VNE table vs altitude and OAT in POH p. 2-11
  (e.g. 8,000 ft: 94/90/86/80/75/69/64 KIAS at −20…+40 °C). DERIVED VD ≈ 1.11 × 102 ≈ **113 KIAS**.

### B.4 Flight demonstrations [F]
| Test | Procedure | Pass |
|---|---|---|
| Sudden power failure (§27.143(e)) | cruise at MCP, min power-on rpm, 0 to VNE, also hover / take-off / VY; delay ≥ **1 s** or normal reaction time, whichever is greater (collective) | controllable; rpm, flapping and dynamics within limits; rpm ≥ minimum transient |
| VNE controllability (§27.143(b)) | aft c.g., MCP, min rpm, power on/off; 1.1 VNE stability point | positive nose-down cyclic margin (guide ≈ 10 % travel); ≥ 30° banked turns |
| 17 kt winds (§27.143(c),(d)) | 0 to ≥ 17 kt from all azimuths, IGE and OGE | clear yaw response after full pedal |
| H-V envelope (§27.87; former §27.79) | high hover: ≥ 1 s delay, max nose-down 10–20°; low hover: no collective lowering; wind ≤ 2 kt | safe landing, rpm ≥ transient minimum |
| R22 H-V (POH p. 5-11) | | SL 1,370 lb: avoid to 400 ft at 0 KIAS, knee ≈ 200 ft / 52 KIAS; 7,000 ft DA 1,300 lb: 700 ft at 0, knee ≈ 250 ft / 60 KIAS |
| R22 autorotation (POH) | | glide 65 KIAS (60–70); max glide 75 KIAS at ≈ 90 %, ≈ 4:1; rpm 97–110 %; flare ≈ 40 ft, level ≈ 8 ft |
| Rotor roughness (§27.251) | 30° bank turns at VNE at min and max rpm; 1.11 VNE points | no excessive vibration |
| Directional stability (§27.177) | sideslip to ±25° (at min-sink speed −15 kt) decreasing to ±10° at VNE | sideslip grows with pedal |
| Flight-loads survey (§27.571, AC) | hover at max/min rpm; 90° spot turns; control reversals; sideward/rearward flight; jump take-off; level at 40/60/80 % VH, VH, VNE; cyclic pull-ups at 60 % and 90 % VH; reversals at 90 % VH; power-to-autorotation at 70 % VNE and VNE; autorotation turns and pull-ups | loads measured (fatigue input) |

### B.5 Teetering-rotor hazards (R22)
- **Low-G cyclic pushovers prohibited** (POH limitation, SN-11): right roll; recover with gentle aft cyclic first. Numeric low-G
  threshold and teeter-stop angle NOT FOUND.
- Turbulence (SFAR 73 / AD 95-26-04): no flight with wind > 25 kt or gust spread > 15 kt; moderate turbulence 60 KIAS to 0.7 VNE.
- Low-rpm stall (SN-10, SN-24): blade stall at about 15° AoA, blow-back, tail-boom strike; fatal above about 40–50 ft.
- Vortex ring (HFH ch. 11, SN-22): descent ≥ 300 fpm at 20–100 % power below translational lift; up to ≈ 6,000 fpm; keep ≥ 30 kt until
  descent < 300 fpm.
- Dynamic rollover (HFH ch. 11): cyclic ineffective beyond ≈ 5–8° of roll; develops in < 2 s; recover by lowering collective over ≈ 2 s.

## C. Common test-pilot stress manoeuvres
Wind-up turn (§23.155); pull-up / pushover (Part 23 does not require flying to n_limit; upset 0.5 g for 5 s then ≤ 1.5 g);
checked pitch (§23.423); rolling pull-out at 2/3 n_limit with full aileron at VA (§§23.349, 23.455); sideslips (§§23.177, 23.441,
27.177, 27.351); dives (§§23.251, 27.1505); doublets. Helicopters: cyclic pull-ups at 60/90 % VH. g-onset rates and build-up steps
NOT FOUND.

## D. Recommended scriptable sequences

### D.1 Aeroplane — C172S normal category, 2,550 lb, SL (VD ≈ 178 KEAS, VC 126, VA 102 KCAS, VS1 53, VSO 48; +3.8 / −1.52 g)
| # | Test | Pass / fail |
|---|---|---|
| A1 | V-n corners: +3.8 at 102, 126, 178 kt; −1.52 at 126 kt; 0 g at 178 kt; flaps 30° +3.0 at 85 KIAS; hold ≥ 3 s; then 1.5× | limit: ≤ yield, no permanent set; ultimate: no failure for 3 s |
| A2 | 1-cos gusts (25 C ≈ 120 ft): ±50 ft/s at VC, ±25 ft/s at VD and VF; lateral 50 ft/s on the fin | ≤ limit; 1.5× ≤ ultimate |
| A3 | Checked pitch at 102 kt (full up then full down) and at 126/178 kt (α̇ = ±340.9/V) | tail loads ≤ limit; n ≤ 3.8 |
| A4 | Rolling pull-out: 2.53 g then full aileron in ≈ 0.2 s at 102 kt; 1/3 roll rate at 178 kt | wing bending/torsion ≤ limit |
| A5 | Rudder kick at 102 kt; 15° sideslip with rudder neutral | fin loads ≤ limit |
| A6 | Dive/flutter: 140 → 178 KEAS in steps, doublets, damping estimate | damping positive, no sharp drop; flutter clear to 1.2 VD |
| A7 | Upset: 0.5 g for 5 s at 160 KCAS, recover at ≤ 1.5 g | peak ≤ midway VNE–VD (≈ 169 KCAS); never > VD |
| A8 | Wings-level stalls: 1 kt/s, flaps 0/10/30°, idle and 75 % MCP | warning ≥ 5 kt early; roll/yaw ≤ 15° |
| A9 | Turning and accelerated stalls: 30° bank, 1 and 3–5 kt/s | ≤ 60°/30° and ≤ 90°/60° bank; n ≤ 3.8 |
| A10 | One-turn spin, flaps 0°/30°, idle and power-on, both directions; abuse cases | recovery ≤ 1 extra turn; V ≤ 163 KIAS; n ≤ 3.8 |
| A11 | Wind-up turn to 3.8 g | stick force ≥ 25.5 lb, no lightening |
| A12 | Stability sweeps, doublets, phugoid release ±15 % | return within ±10 %; Dutch roll to 1/10 in ≤ 7 cycles |
| A13 | Roll reversal 30° → −30° | ≤ 5 s / ≤ 4 s |
| A14 | Crew: seat n_z in flight; crash pulses 26 g and 19 g | +3.8 / −1.52 g in flight; HIC ≤ 1,000, lumbar ≤ 1,500 lb |

### D.2 Helicopter — R22 Beta II, 1,370 lb, SL (VNE 102 KIAS, VD ≈ 113; +3.5 / −1.0 g Part 27 default; rpm 101–104 % on, 90–110 % off)
| # | Test | Pass / fail |
|---|---|---|
| H1 | Cyclic pull-ups at 60 % VH, 90 % VH and VNE to +3.5 g (thrust-limited); −1.0 g structural; max/min rpm; 1.5× | blade/hub/mast ≤ limit; blade clearance kept |
| H2 | 30 ft/s vertical gust at 0–113 KIAS | gust n < manoeuvre n; ≤ limit |
| H3 | Pedal step in ≤ 0.2 s to steady sideslip (≤ 90°) up to 0.6 VNE, cap 15° at VNE | boom / tail-rotor loads ≤ limit |
| H4 | Power failure at 90 % VH and VNE: hold collective 1.0 s, then lower and set up 65 KIAS; hover/take-off/VY with normal reaction | rpm ≥ 90 %; flapping within stops; steady autorotation |
| H5 | Autorotation sweep 45–102 KIAS | rpm within 90–110 % by collective; best glide ≈ 75 KIAS, ≈ 4:1 |
| H6 | H-V grid around the POH curve (high hover with 1 s delay; low hover without collective) | rpm ≥ transient minimum; reproduce SL 400 ft at 0 kt, knee ≈ 200 ft / 52 kt |
| H7 | 1.1 VNE; 30° bank turns at VNE at 101 % and 104 % | nose-down cyclic margin positive; vibration/blade loads within limits |
| H8 | 17 kt wind from all azimuths, IGE/OGE; sideward/rearward to 17 kt | clear yaw response at full pedal |
| H9 | Low-G pushovers (hazard demo, prohibited on R22): wrong vs correct recovery | report flapping vs stop, mast moment, roll rate |
| H10 | Low-rpm: raise collective with fixed throttle, 101 → 97 → 90 → 80 % | horn at 97 %; blade stall ≈ 15° AoA |
| H11 | Vortex ring: OGE vertical descent at 300 / 600 / 1,000 fpm | onset reproduced; altitude loss logged |
| H12 | Dynamic rollover: right skid pinned, thrust ≈ weight | critical roll ≈ 5–8°; collective arrests the roll |
| H13 | Crew: seat n_z; crash pulses 30 g and 18.4 g | +3.5 / −1.0 g in flight; static 4/16/8/20/1.5 g |

## E. Gaps (NOT FOUND)
C172S: VD/VDF, VB, inverted stall line, lift-curve slope, rudder throw, spar allowables. R22: design limit n, teeter/flapping stop
angle, transient minimum rpm, normal pilot reaction time, numeric low-G threshold, blade allowables, TCDS H10WE, SN-9 text.
Flutter: numeric damping margin (AC 23.629-1B not retrieved). CS-23 / CS-27 values not verified.
