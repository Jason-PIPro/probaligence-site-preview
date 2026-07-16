// studio-stories.js
//
// The STORIES content object for the "Stochos Flow Web" guided builder (v3:
// the faithful-graph rework; v4: the "ungate + agent chat" rework, both
// 2026-07-13). studio.js's build state machine reads the `phases`/`branch`/
// `goals`/`deploy` keys below; the AGENT CHAT (v4, replacing the old step-card
// inspector) reads the new `chat` object per domain:
//   chat.welcome         -- the agent's opening message (goal + drag hint)
//   chat.explainWorkflow -- answer for the "Explain this workflow" preset
//   chat.explainResult   -- answer for the "Explain the result" preset (shown
//                           once the graph is fully built)
//   chat.nodeWhat{id}    -- answer for "What does <node> do?", one line per
//                           node INSTANCE id (readerX, readerY, split, fit,
//                           pam, branch, boInit, boNext, webapp); also reused
//                           as the anchored info popover shown when that node
//                           is placed. Every preset is a SCRIPTED chip click,
//                           never free text (the agent panel is not a live
//                           LLM; presets keep that honest).
// Per-phase `beat` lines double as the agent's short reaction posted to chat
// once that phase's node(s) finish wiring (unchanged content, new venue).
//
// v3 replaces the v2 "one node per step, six fake decisions" shape with the REAL
// Stochos Flow graph for a scalar-regression + sensitivity + Bayesian-optimization
// workflow, grounded in Stochos_Flow_examples/*.prompt.txt (the ground truth: exact
// node lists and connection counts the real Flow agent builds). Every domain shares
// the same trunk:
//   excel_reader (Inputs X) + excel_reader (Targets Y)   -- two readers, like every
//     real example: features and targets load from SEPARATE nodes.
//   -> train_test_split (X, Y in; X_train/Y_train out)   -- holds back real
//     validation data; does not choose a target column (there is no such control
//     on this node in Flow -- the target is whatever you loaded into the Y reader).
//   -> dimgp_regr_fit (X_train, Y_train in; models out)  -- ONE model, one pass,
//     the whole design-space response surface for the property this file models.
//   -> pam_regr (X_train, Y_train, models in)            -- three real in-ports,
//     verbatim from 2_Sensitivity/2_1_var_bases_sens_scalar.prompt.txt: "connect
//     X_train, Y_train, and the trained models to pam_regr".
// Then a PER-INDUSTRY analysis branch on real nodes (dist_cor / sobol_indices),
// then the shared close:
//   bayesian_opt_init -> bayesian_opt_next_sample (bo_obj, models, X, Y in; 4
//     real in-ports, from 3_2_Manual_optimization_simple_interface.prompt.txt)
//   -> web_app_scalar (models, X, Y in), matching 5_1_scalar_to_scalar.prompt.txt.
// paint and chemistry use this manual-BO trunk (a lab-data domain: there is no
// simulation to call, only the excel_reader's already-measured runs).
//
// v4.3 (2026-07-13, ground-truth audit fix batch): two wiring corrections plus
// one structural rework, verified against the real examples' .prompt.txt files:
//   1. OFF THE SPLIT. `bayesian_opt_next_sample`'s X/Y in-ports and
//      `web_app_scalar`'s X/Y in-ports now read the two Excel Readers DIRECTLY,
//      not train_test_split's held-out subset -- verbatim from
//      3_2_Manual_optimization_simple_interface.prompt.txt ("data_array to X
//      and Y") and 5_1_scalar_to_scalar.prompt.txt (fed by the two readers +
//      fit). `dist_cor` (paint's branch) does the same: it reads the two
//      readers directly, no split needed, matching
//      2_Sensitivity/1_correlation_coefficients (no train_test_split node at
//      all in that real example). train_test_split now legitimately serves
//      only `dimgp_regr_fit` and `pam_regr` (chemistry's `sobol_indices`
//      branch still reads split's X_train too, verbatim from
//      2_1_var_bases_sens_scalar.prompt.txt: "connect the trained models and
//      X_train to it" -- that one is correct as-is).
//   2. ENGINEERING AND BOTTLE become the AUTOMATIC-BO story (the faithful
//      pattern for a domain with a simulation in the loop, grounded in
//      3_4_Automatic_optimization_DoE_simple_interface.prompt.txt: "Create a
//      Python Solver node as the objective function evaluator... connect
//      bayesian_opt from init to bayesian_opt_optimize:bo_obj, and connect
//      python_solver as the evaluator (evaluator port) to true_evaluator").
//      `bayesian_opt_next_sample` is REMOVED from these two domains only;
//      paint and chemistry keep the manual Next-Sample pattern (correct for a
//      lab-data domain -- there is nothing to call automatically). In its
//      place: `bayesian_opt_init` -> `bayesian_opt_optimize` (labeled "BO
//      Optimize", ins `bo_obj` + `true_evaluator`, outs `X`/`Y`/`models` --
//      the real function never takes a trained `models` input, it produces
//      its own) fed by BO Init and a new `python_solver` node (a SOURCE node,
//      "the heat-sink/load-test simulation", placeable from the start). The
//      studio's old separate `analyze` phase (the Pareto chart) and
//      `optimize` phase (BO Init + Next Sample) MERGE into one `optimize`
//      phase for these two domains, since BO Optimize now IS both the
//      optimizer and the Pareto-front payoff -- the graph stays a 9-node
//      build (2 readers, split, fit, pam, boInit, python_solver, bo_optimize,
//      webapp), just recomposed. `story.branch.kind === 'pareto'` is the flag
//      studio.js reads to switch a domain onto this automatic-pattern node
//      set/phase list (see buildNodeDefs/buildEdgeDefs/buildPhases there);
//      only engineering and bottle set `kind: 'pareto'`, so paint/chemistry
//      are unaffected.
//
// v4.2 (2026-07-13, direct feedback): there are no decisions or chips left
// anywhere on the canvas. Two real node parameters used to be small chip/
// slider popovers; both now just apply their default silently and the
// anchored popover explains what happened instead of offering a choice:
//   1. `ratio` at the split phase: train_test_split's train/test split. Always
//      70% train, the standard engineering default -- still a genuine held-out
//      validation split, just not a pickable one (Flow's node has a fixed
//      parameter here, not a runtime chip). studio.js builds this popover's
//      copy from `chat.nodeWhat.split` plus the computed 70/30 split, so
//      nothing new is authored per domain for it.
//   2. `strategy` (kappa) at the optimize phase: the Bayesian-optimization
//      explore/exploit acquisition tradeoff, fixed at STOCHOS's balanced
//      default. The objective direction (goal) is read from the property
//      being modeled, not chosen -- Flow has no runtime "pick your target"
//      control either; that choice happens once, offline, when you decide
//      what to put in the Targets (Y) reader. `phases.optimize.appliedInfo`
//      below is the domain-flavored statement of what that balance means,
//      read by studio.js for that popover.
// The validate phase's confidence interval is fixed at the standard engineering
// default (95%, z=1.96), stated as such rather than offered as a chip.
//
// Honesty rules baked into the copy:
//   - The datasets here are synthetic and illustrative. No line claims a benchmark
//     or a real product result, and no line compares STOCHOS to anything.
//   - STOCHOS is framed as a predictive engine (DIM-GP), not a chat assistant.
//   - Field names, units and goals match app/data/<domain>.json exactly.
//   - No em dashes and no en dashes anywhere. Commas, colons or rewrites only.

export const STORIES = {

  // =====================================================================
  // PAINT & COATINGS
  //   axes    : tio2_pct, binder_pct
  //   outputs : contrast_ratio, gloss, scrub, viscosity, cost
  //   data    : 54 measured formulations
  //   branch  : dist_cor, real node, reads the two Excel Readers directly (no
  //             model or split needed) and scores how strongly each property
  //             pair moves together
  // =====================================================================
  paint: {
    domain: 'paint',
    tag: 'Paint & coatings',
    outcome: 'Formulate the best coating',
    pitch: 'Find the highest hiding power with viscosity and gloss in spec and cost down.',
    accent: 'var(--accent)',
    axes: ['tio2_pct', 'binder_pct'],
    outputs: ['contrast_ratio', 'gloss', 'scrub', 'viscosity', 'cost'],
    defaultOutput: 'contrast_ratio',
    totalRuns: 54,
    goals: { contrast_ratio: 'high', gloss: 'window', scrub: 'high', viscosity: 'window', cost: 'low' },
    phases: {
      data: {
        kicker: 'Step 1 of 7 · Data',
        title: 'Load the lab file',
        why: 'STOCHOS learns the surface from your measured tins. It assumes no recipe.',
        beat: 'Two Excel Reader nodes load the same lab file: one reads the columns you controlled (TiO2, binder), the other reads what you measured.',
        changed: 'Your measured tins land on the canvas as real training points.'
      },
      split: {
        kicker: 'Step 2 of 7 · Split',
        title: 'Split for honest validation',
        why: 'Train/Test Split holds back a fraction of your tins so PAM can validate on runs the model has never seen. It does not choose what to model, only how the data divides.',
        beat: 'Train/Test Split routes the input and target columns into a training set and a held-out set.',
        changed: 'Fewer training tins leave wider gaps between TiO2 and binder levels foggy. More held-out tins make PAM stricter.'
      },
      fit: {
        kicker: 'Step 3 of 7 · Fit',
        title: 'Fit the full response surface',
        why: 'DIM-GP Fit trains in one pass over the training tins. It assumes no formula. The fog is its calibrated uncertainty.',
        beat: 'DIM-GP Fit trains on the split training set. The full hiding-power surface appears on the canvas.',
        changed: 'The surface fills in, brightest in the TiO2-rich corner, where hiding power peaks.'
      },
      validate: {
        kicker: 'Step 4 of 7 · Validate',
        title: 'Validate with PAM',
        why: 'PAM predicts each held-out tin as if it had never been seen, so R2 and RMSE are honest, with no data leakage.',
        beat: 'PAM Validation reads X_train, Y_train and the trained model, then scores predictions on the held-out tins.',
        changed: 'Predicted vs measured lines up on the diagonal. R2 and RMSE are read at a 95% confidence interval, the standard engineering default.'
      },
      optimize: {
        kicker: 'Step 6 of 7 · Optimize',
        title: 'Propose the next formulation',
        why: 'BO Init configures the search space; Next Sample proposes the next real tin to mix, using the trained surface as a guide.',
        beat: 'BO Init sets up the search space. Next Sample reads bo_obj, the trained model, and your lab data (inputs and targets), then proposes the next formulation.',
        appliedInfo: 'It balances trying promising formulations against probing regions STOCHOS is still unsure about.',
        goalNote: 'Objective: maximize contrast_ratio, read from the property this workflow models.',
        changed: 'New candidate formulations appear on the surface. The uncertainty fog thins where the model has sampled.'
      },
      deploy: {
        kicker: 'Step 7 of 7 · Deploy',
        title: 'Export as a web app',
        why: 'Web App Export wraps the trained model in sliders so any colleague can query it without opening Stochos Flow.',
        beat: 'Web App Export reads the trained model plus your inputs and targets, then packages a browser predictor.',
        changed: 'A live predictor appears: move TiO2 and binder sliders, read the predicted hiding with its confidence band.'
      }
    },
    branch: {
      node: 'dist_cor', icon: 'plot_bar', label: 'Correlations', kind: 'correlation', badge: 'COR',
      ins: ['X', 'Y'], outs: ['dist_cor'],
      edges: [
        { from: 'readerX', fromPort: 0, to: 'branch', toPort: 0 },
        { from: 'readerY', fromPort: 0, to: 'branch', toPort: 1 }
      ],
      title: 'Read the property trade-offs',
      why: 'dist_cor reads the lab data directly, no model or split needed, and scores how strongly each property pair moves together.',
      story: 'Higher TiO2 improves hiding but also raises cost and shifts scrub. The correlations make that trade-off quantitative.',
      changed: 'The bars show which output pairs move together and which fight. Hiding vs cost has the strongest tension.'
    },
    deploy: {
      appName: 'Coating Predictor',
      blurb: 'Move the two main ingredients, read hiding power with its confidence band.',
      sliders: ['tio2_pct', 'binder_pct']
    },
    chat: {
      welcome: 'I am the Stochos Flow agent. Our goal: formulate a paint that hides the wall in one coat without losing scrub resistance or pushing up cost. Drag nodes from the palette on the left onto their dashed slots, then wire each one to its upstream source. Ask me anything with the chips below.',
      explainWorkflow: 'Two Excel Readers load your lab data, Train/Test Split holds back a validation set, DIM-GP Fit trains the hiding-power surface, and PAM Validation scores it honestly. Correlations show the trade-offs, then Bayesian Optimization proposes the next tin to mix, and Web App Export ships a predictor.',
      explainResult: 'The trained surface predicts hiding power from TiO2 and binder levels, validated against held-out tins. The correlation chart shows hiding trades against cost. STOCHOS proposed a next formulation to try, and the web app lets a colleague query the model without opening Stochos Flow.',
      nodeWhat: {
        readerX: 'Excel Reader loads the columns you controlled, TiO2 and binder percent, as X.',
        readerY: 'Excel Reader loads what you measured, contrast ratio, gloss, scrub, viscosity and cost, as Y.',
        split: 'Train/Test Split holds back a fraction of your tins so PAM can validate on runs the model has never seen.',
        fit: 'DIM-GP Fit trains one response surface over the training tins. It assumes no formula.',
        pam: 'PAM Validation predicts each held-out tin and scores R2 and RMSE honestly, with no data leakage.',
        branch: 'Distance Correlation reads the lab data directly and scores how strongly each output pair moves together.',
        boInit: 'BO Init configures the search space STOCHOS will explore for the next formulation.',
        boNext: 'Next Sample proposes the next real tin to mix, using the trained surface as a guide.',
        webapp: 'Web App Export wraps the trained model in sliders so a colleague can query it without opening Stochos Flow.'
      }
    }
  },

  // =====================================================================
  // CHEMISTRY
  //   axes    : temperature, catalyst
  //   outputs : yield_pct, selectivity, cost
  //   data    : 45 measured reactions
  //   branch  : sobol_indices, real node, reads X_train + the trained model
  // =====================================================================
  chemistry: {
    domain: 'chemistry',
    tag: 'Chemistry',
    outcome: 'Push a reaction to higher yield',
    pitch: 'Lift the yield with selectivity held in spec and raw-material cost down.',
    accent: 'var(--warm)',
    axes: ['temperature', 'catalyst'],
    outputs: ['yield_pct', 'selectivity', 'cost'],
    defaultOutput: 'yield_pct',
    totalRuns: 45,
    goals: { yield_pct: 'high', selectivity: 'high', cost: 'low' },
    phases: {
      data: {
        kicker: 'Step 1 of 7 · Data',
        title: 'Load the reaction log',
        why: 'STOCHOS learns the response from your measured reactions. It assumes no kinetics.',
        beat: 'Two Excel Reader nodes load the same reaction log: one reads temperature and catalyst loading, the other reads what you measured.',
        changed: 'Your run reactions land on the canvas as real training points.'
      },
      split: {
        kicker: 'Step 2 of 7 · Split',
        title: 'Split for honest validation',
        why: 'Train/Test Split holds back a fraction of your reactions so PAM can validate on runs the model has never seen.',
        beat: 'Train/Test Split routes the input and target columns into a training set and a held-out set.',
        changed: 'Fewer training reactions leave wider gaps between temperature settings foggy. More held-out reactions make PAM stricter.'
      },
      fit: {
        kicker: 'Step 3 of 7 · Fit',
        title: 'Fit the full response surface',
        why: 'DIM-GP Fit trains in one pass over the training reactions. It assumes no kinetics. The fog is its calibrated uncertainty.',
        beat: 'DIM-GP Fit trains on the split training set. The full yield surface blooms across the temperature-catalyst plane.',
        changed: 'The surface fills in, brightest in the warm, well-catalyzed band where yield peaks.'
      },
      validate: {
        kicker: 'Step 4 of 7 · Validate',
        title: 'Validate with PAM',
        why: 'PAM predicts each held-out reaction as if it had never been seen, so R2 and RMSE are honest, with no data leakage.',
        beat: 'PAM Validation reads X_train, Y_train and the trained model, then scores predictions on the held-out reactions.',
        changed: 'Predicted vs measured lines up on the diagonal. R2 and RMSE are read at a 95% confidence interval, the standard engineering default.'
      },
      optimize: {
        kicker: 'Step 6 of 7 · Optimize',
        title: 'Propose the next reaction',
        why: 'BO Init configures the search space; Next Sample proposes the next reaction to run, using the trained surface as a guide.',
        beat: 'BO Init sets up the search space. Next Sample reads bo_obj, the trained model, and your reaction log (inputs and targets), then proposes the next reaction.',
        appliedInfo: 'It balances trying promising reactions against probing conditions STOCHOS is still unsure about.',
        goalNote: 'Objective: maximize yield_pct, read from the property this workflow models.',
        changed: 'New candidate reactions appear on the surface. The uncertainty fog thins around the sampled points.'
      },
      deploy: {
        kicker: 'Step 7 of 7 · Deploy',
        title: 'Export as a web app',
        why: 'Web App Export wraps the trained model in sliders so any chemist can query it without opening Stochos Flow.',
        beat: 'Web App Export reads the trained model plus your inputs and targets, then packages a browser predictor.',
        changed: 'A live predictor appears: set temperature and catalyst, read predicted yield with its confidence band.'
      }
    },
    branch: {
      node: 'sobol_indices', icon: 'sobol_indices', label: 'Sobol Indices', kind: 'tornado', badge: 'SOBOL',
      ins: ['X_train', 'models'], outs: ['sobol_indices'],
      edges: [
        { from: 'split', fromPort: 0, to: 'branch', toPort: 0 },
        { from: 'fit', fromPort: 0, to: 'branch', toPort: 1 }
      ],
      title: 'Rank what drives the yield',
      why: 'Sobol Indices decomposes the variance in the trained surface, reading the training inputs and the model together.',
      story: 'Temperature towers over catalyst loading as the primary lever on yield.',
      changed: 'The tornado bars rank each input by variance contribution. The longest bar is the lever worth turning first.'
    },
    deploy: {
      appName: 'Reaction Predictor',
      blurb: 'Set temperature and catalyst loading, read yield with its confidence band.',
      sliders: ['temperature', 'catalyst']
    },
    chat: {
      welcome: 'I am the Stochos Flow agent. Our goal: tune a reaction for higher yield while selectivity stays high and cost stays down. Drag nodes from the palette onto their dashed slots, then wire each one to its upstream source. Ask me anything with the chips below.',
      explainWorkflow: 'Two Excel Readers load your reaction log, Train/Test Split holds back a validation set, DIM-GP Fit trains the yield surface, and PAM Validation scores it honestly. Sobol Indices ranks temperature against catalyst loading, then Bayesian Optimization proposes the next reaction to run, and Web App Export ships a predictor.',
      explainResult: 'The trained surface predicts yield from temperature and catalyst loading, validated against held-out reactions. Sobol Indices shows temperature is the primary lever. STOCHOS proposed a next reaction to try, and the web app lets a chemist query the model without opening Stochos Flow.',
      nodeWhat: {
        readerX: 'Excel Reader loads temperature and catalyst loading, the columns you controlled, as X.',
        readerY: 'Excel Reader loads what you measured, yield, selectivity and cost, as Y.',
        split: 'Train/Test Split holds back a fraction of your reactions so PAM can validate on runs the model has never seen.',
        fit: 'DIM-GP Fit trains one response surface over the training reactions. It assumes no kinetics.',
        pam: 'PAM Validation predicts each held-out reaction and scores R2 and RMSE honestly, with no data leakage.',
        branch: 'Sobol Indices decomposes the variance in the trained surface, ranking which input drives yield most.',
        boInit: 'BO Init configures the search space STOCHOS will explore for the next reaction.',
        boNext: 'Next Sample proposes the next reaction to run, using the trained surface as a guide.',
        webapp: 'Web App Export wraps the trained model in sliders so a chemist can query it without opening Stochos Flow.'
      }
    }
  },

  // =====================================================================
  // ENGINEERING
  //   axes    : pin_height, pin_spacing
  //   outputs : peak_temp, pressure_drop, mass
  //   data    : 48 simulated heat-sink designs
  //   branch  : bayesian_opt_optimize (labeled "BO Optimize"), the real
  //             AUTOMATIC multi-objective (Pareto) BO node, fed by BO Init
  //             (bo_obj) and a Python Solver source node (true_evaluator),
  //             replacing the manual Next-Sample pattern -- a simulation is
  //             in the loop here, so STOCHOS can drive it directly. The old
  //             separate `analyze` phase merges into `optimize`: the front
  //             IS the optimize payoff. See v4.3 in this file's header.
  // =====================================================================
  engineering: {
    domain: 'engineering',
    tag: 'Engineering simulation',
    outcome: 'Design a pin-fin heat sink',
    pitch: 'Cool the chip to a low peak temperature without a heavy pressure-drop penalty.',
    accent: 'var(--accent-2)',
    axes: ['pin_height', 'pin_spacing'],
    outputs: ['peak_temp', 'pressure_drop', 'mass'],
    defaultOutput: 'peak_temp',
    totalRuns: 48,
    goals: { peak_temp: 'low', pressure_drop: 'low', mass: 'low' },
    phases: {
      data: {
        kicker: 'Step 1 of 6 · Data',
        title: 'Load the design sheet',
        why: 'STOCHOS learns the trend from your solved designs. It replaces no solver run.',
        beat: 'Two Excel Reader nodes load the same design sheet: one reads pin height and spacing, the other reads the simulated results.',
        changed: 'Your solved heat-sink designs land on the canvas as real training points.'
      },
      split: {
        kicker: 'Step 2 of 6 · Split',
        title: 'Split for honest validation',
        why: 'Train/Test Split holds back a fraction of your designs so PAM can validate on runs the model has never seen.',
        beat: 'Train/Test Split routes the input and target columns into a training set and a held-out set.',
        changed: 'Fewer training designs leave wider gaps between pin heights foggy. More held-out designs make PAM stricter.'
      },
      fit: {
        kicker: 'Step 3 of 6 · Fit',
        title: 'Fit the full response surface',
        why: 'DIM-GP Fit trains in one pass over the training designs. It replaces no solver run. The fog is its calibrated uncertainty.',
        beat: 'DIM-GP Fit trains on the split training set. The full peak-temperature surface appears on the canvas.',
        changed: 'The surface fills in, darkest where tall, closely spaced pins keep the chip coolest.'
      },
      validate: {
        kicker: 'Step 4 of 6 · Validate',
        title: 'Validate with PAM',
        why: 'PAM predicts each held-out design as if it had never been seen, so R2 and RMSE are honest, with no data leakage.',
        beat: 'PAM Validation reads X_train, Y_train and the trained model, then scores predictions on the held-out designs.',
        changed: 'Predicted vs simulated lines up on the diagonal. R2 and RMSE are read at a 95% confidence interval, the standard engineering default.'
      },
      optimize: {
        kicker: 'Step 5 of 6 · Optimize',
        title: 'Run the automatic optimizer',
        why: 'BO Init configures the search space. Python Solver stands in for the heat-sink simulation, the live evaluator. BO Optimize runs the closed loop directly against it: propose a design, simulate it, refit the model, repeat.',
        beat: 'BO Init sets up the search space. Python Solver plugs in as the live evaluator, standing in for the heat-sink simulation. BO Optimize runs the loop directly against it, proposing a design, simulating it, and refitting the model, mapping where cooling trades against pressure drop.',
        appliedInfo: 'With a simulation in the loop, STOCHOS can drive it directly: propose a design, evaluate it, refit the model, repeat, instead of waiting on you to run each one by hand.',
        goalNote: 'Objective: minimize peak_temp, read from the property this workflow models.',
        changed: 'New candidate designs appear across the front. The automatic loop keeps refitting the model as it explores.'
      },
      deploy: {
        kicker: 'Step 6 of 6 · Deploy',
        title: 'Export as a web app',
        why: 'Web App Export wraps the trained model in sliders so any engineer can size a heat sink without a solver job.',
        beat: 'Web App Export reads the trained model plus your inputs and targets, then packages a browser predictor.',
        changed: 'A live predictor appears: set pin height and spacing, read predicted peak temperature with its confidence band.'
      }
    },
    branch: {
      node: 'bayesian_opt_optimize', icon: 'bo_optimize', label: 'BO Optimize', kind: 'pareto', badge: 'PARETO',
      ins: ['bo_obj', 'true_evaluator'], outs: ['X', 'Y', 'models'],
      edges: [
        { from: 'boInit', fromPort: 0, to: 'branch', toPort: 0 },
        { from: 'solver', fromPort: 0, to: 'branch', toPort: 1 }
      ],
      title: 'Map the Pareto trade-off',
      why: 'BO Optimize is the real automatic Bayesian-optimization node (acq_func EVI). It reads bo_obj from BO Init and true_evaluator from Python Solver, then runs the loop directly against the solver, refitting the model each iteration and mapping where cooling trades against pressure drop.',
      story: 'Cooler designs consistently cost more pressure drop. The front is the set of best compromises: nothing beats a point on it on both objectives at once.',
      changed: 'The front shows every Pareto-optimal design, found by the automatic run over both objectives: you cannot improve on both outputs simultaneously from any point on it.'
    },
    deploy: {
      appName: 'Heat Sink Predictor',
      blurb: 'Set pin height and spacing, read peak temperature with its confidence band.',
      sliders: ['pin_height', 'pin_spacing']
    },
    chat: {
      welcome: 'I am the Stochos Flow agent. Our goal: design a pin-fin heat sink that cools the chip without a heavy pressure-drop penalty. Drag nodes from the palette onto their dashed slots, then wire each one to its upstream source. Ask me anything with the chips below.',
      explainWorkflow: 'Two Excel Readers load your design sheet, Train/Test Split holds back a validation set, DIM-GP Fit trains the peak-temperature surface, and PAM Validation scores it honestly. BO Init configures the search space, Python Solver stands in for the heat-sink simulation, and BO Optimize runs the loop directly against it, propose, simulate, refit, repeat, mapping the Pareto front. Web App Export ships a predictor.',
      explainResult: 'The trained surface predicts peak temperature from pin height and spacing, validated against held-out designs. The Pareto front shows the best cooling-versus-pressure-drop compromises, found by the automatic optimizer running directly against the connected solver. The web app lets an engineer size a heat sink without a solver job.',
      nodeWhat: {
        readerX: 'Excel Reader loads pin height and spacing, the columns you controlled, as X.',
        readerY: 'Excel Reader loads the simulated results, peak temperature, pressure drop and mass, as Y.',
        split: 'Train/Test Split holds back a fraction of your designs so PAM can validate on runs the model has never seen.',
        fit: 'DIM-GP Fit trains one response surface over the training designs. It replaces no solver run.',
        pam: 'PAM Validation predicts each held-out design and scores R2 and RMSE honestly, with no data leakage.',
        boInit: 'BO Init configures the search space the automatic optimizer will explore.',
        solver: 'Python Solver is where a real simulation would plug in; here it stands in for the heat-sink simulation. The demo solver is illustrative of a real simulation hook, not a performance claim.',
        branch: 'BO Optimize is the real automatic Bayesian-optimization node. It runs directly against the connected solver, refitting the model each iteration, mapping where cooling trades against pressure drop.',
        webapp: 'Web App Export wraps the trained model in sliders so an engineer can size a heat sink without a solver job.'
      }
    }
  },

  // bottle: the engineering challenge problem (a pressure bottle), so the studio can
  // build the same case the "Beat Stochos" game hands off. Same schema.
  bottle: {
    domain: 'bottle',
    tag: 'Engineering',
    outcome: 'Design a bottle that survives',
    pitch: 'Shape a bottle that holds the 26 bar rated test at the lowest weight and cost.',
    accent: 'var(--accent-2)',
    axes: ['height_mm', 'diameter_mm'],
    outputs: ['burst_bar', 'weight_g', 'cost_rel'],
    defaultOutput: 'burst_bar',
    totalRuns: 48,
    goals: { burst_bar: 'high', weight_g: 'low', cost_rel: 'low' },
    phases: {
      data: {
        kicker: 'Step 1 of 6 · Data',
        title: 'Load the test log',
        why: 'STOCHOS learns the trend from your tested designs. It replaces no solver run.',
        beat: 'Two Excel Reader nodes load the same test log: one reads height and diameter, the other reads the load-test results.',
        changed: 'Your tested bottle designs land on the canvas as real training points.'
      },
      split: {
        kicker: 'Step 2 of 6 · Split',
        title: 'Split for honest validation',
        why: 'Train/Test Split holds back a fraction of your bottles so PAM can validate on runs the model has never seen.',
        beat: 'Train/Test Split routes the input and target columns into a training set and a held-out set.',
        changed: 'Fewer training bottles leave wider gaps between shapes foggy. More held-out bottles make PAM stricter.'
      },
      fit: {
        kicker: 'Step 3 of 6 · Fit',
        title: 'Fit the full response surface',
        why: 'DIM-GP Fit trains in one pass over the training bottles. It assumes no mechanics formula. The fog is its calibrated uncertainty.',
        beat: 'DIM-GP Fit trains on the split training set. The full burst-pressure surface appears on the canvas.',
        changed: 'The surface fills in, brightest where a compact, stiff bottle holds the most pressure.'
      },
      validate: {
        kicker: 'Step 4 of 6 · Validate',
        title: 'Validate with PAM',
        why: 'PAM predicts each held-out bottle as if it had never been seen, so R2 and RMSE are honest, with no data leakage.',
        beat: 'PAM Validation reads X_train, Y_train and the trained model, then scores predictions on the held-out bottles.',
        changed: 'Predicted vs tested lines up on the diagonal. R2 and RMSE are read at a 95% confidence interval, the standard engineering default.'
      },
      optimize: {
        kicker: 'Step 5 of 6 · Optimize',
        title: 'Run the automatic optimizer',
        why: 'BO Init configures the search space. Python Solver stands in for the load-test simulation, the live evaluator. BO Optimize runs the closed loop directly against it: propose a shape, simulate it, refit the model, repeat.',
        beat: 'BO Init sets up the search space. Python Solver plugs in as the live evaluator, standing in for the load-test simulation. BO Optimize runs the loop directly against it, proposing a shape, simulating it, and refitting the model, mapping where strength trades against weight.',
        appliedInfo: 'With a simulation in the loop, STOCHOS can drive it directly: propose a shape, evaluate it, refit the model, repeat, instead of waiting on you to run each one by hand.',
        goalNote: 'Objective: hold the 26 bar rated test, then the lightest, cheapest design, read from the properties this workflow models.',
        changed: 'New candidate shapes appear across the front. The automatic loop keeps refitting the model as it explores.'
      },
      deploy: {
        kicker: 'Step 6 of 6 · Deploy',
        title: 'Export as a web app',
        why: 'Web App Export wraps the trained model in sliders so any engineer can size a bottle without a load test.',
        beat: 'Web App Export reads the trained model plus your inputs and targets, then packages a browser predictor.',
        changed: 'A live predictor appears: set height and diameter, read predicted burst pressure with its confidence band.'
      }
    },
    branch: {
      node: 'bayesian_opt_optimize', icon: 'bo_optimize', label: 'BO Optimize', kind: 'pareto', badge: 'PARETO',
      ins: ['bo_obj', 'true_evaluator'], outs: ['X', 'Y', 'models'],
      edges: [
        { from: 'boInit', fromPort: 0, to: 'branch', toPort: 0 },
        { from: 'solver', fromPort: 0, to: 'branch', toPort: 1 }
      ],
      title: 'Map the Pareto trade-off',
      why: 'BO Optimize is the real automatic Bayesian-optimization node (acq_func EVI). It reads bo_obj from BO Init and true_evaluator from Python Solver, then runs the loop directly against the solver, refitting the model each iteration and mapping where strength trades against weight.',
      story: 'Higher burst pressure and lower weight are in tension. The front is the set of best compromises: nothing beats a point on it on both objectives at once.',
      changed: 'The front shows every Pareto-optimal design, found by the automatic run over both objectives: nothing beats a point on it on both objectives.'
    },
    deploy: {
      appName: 'Bottle Predictor',
      blurb: 'Set height and diameter, read burst pressure with its confidence band.',
      sliders: ['height_mm', 'diameter_mm']
    },
    chat: {
      welcome: 'I am the Stochos Flow agent. Our goal: a bottle that holds the 26 bar rated test at the lowest weight and cost. Drag nodes from the palette onto their dashed slots, then wire each one to its upstream source. Ask me anything with the chips below.',
      explainWorkflow: 'Two Excel Readers load your test log, Train/Test Split holds back a validation set, DIM-GP Fit trains the burst-pressure surface, and PAM Validation scores it honestly. BO Init configures the search space, Python Solver stands in for the load-test simulation, and BO Optimize runs the loop directly against it, propose, simulate, refit, repeat, mapping the Pareto front. Web App Export ships a predictor.',
      explainResult: 'The trained surface predicts burst pressure from height and diameter, validated against tested bottles. The Pareto front shows the best strength-versus-weight compromises, found by the automatic optimizer running directly against the connected solver. The web app lets an engineer size a bottle without a load test.',
      nodeWhat: {
        readerX: 'Excel Reader loads height and diameter, the columns you controlled, as X.',
        readerY: 'Excel Reader loads the load-test results, burst pressure, weight and cost, as Y.',
        split: 'Train/Test Split holds back a fraction of your bottles so PAM can validate on runs the model has never seen.',
        fit: 'DIM-GP Fit trains one response surface over the training bottles. It assumes no mechanics formula.',
        pam: 'PAM Validation predicts each held-out bottle and scores R2 and RMSE honestly, with no data leakage.',
        boInit: 'BO Init configures the search space the automatic optimizer will explore.',
        solver: 'Python Solver is where a real simulation would plug in; here it stands in for the load-test simulation. The demo solver is illustrative of a real simulation hook, not a performance claim.',
        branch: 'BO Optimize is the real automatic Bayesian-optimization node. It runs directly against the connected solver, refitting the model each iteration, mapping where strength trades against weight.',
        webapp: 'Web App Export wraps the trained model in sliders so an engineer can size a bottle without a load test.'
      }
    }
  }
};
