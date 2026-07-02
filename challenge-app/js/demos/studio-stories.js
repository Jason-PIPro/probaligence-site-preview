// studio-stories.js
//
// The STORIES content object for the "Stochos Flow Web" guided builder (v2).
// The studio.js state machine and studio-field.js renderer read these keys.
//
// One object per industry. Each tells a concrete story a cold visitor can follow,
// building a Stochos Flow workflow node by node: load data with the Excel Reader,
// select output column(s) with Train/Test Split, fit ONE DIM-GP that covers the
// whole design-space response surface, validate it with PAM, run a per-industry
// analysis branch, run Bayesian optimization for the next experiment, then export
// a Web App. studio.js supplies the machinery and the fixed decision vocabulary
// (budget, output, transform, ci, goal, strategy); this file supplies only copy,
// the per-domain option lists, and the per-domain analysis branch.
//
// STOCHOS semantics (technically correct copy - read before editing):
//   - DIM-GP Fit trains ONE model per output column. The model learns the ENTIRE
//     design-space response surface in one fit - all inputs, all interactions, all
//     non-linearities. You do not "choose what to predict step by step"; you select
//     which output column to map at this step, and DIM-GP fits the full surface for it.
//   - Train/Test Split holds back a fraction of runs for held-out validation and
//     routes the selected output column to the DIM-GP Fit node. It does NOT narrow
//     the design space or filter inputs.
//   - PAM (Predictive Accuracy Metric) cross-validates the model: it predicts each
//     held-back run as if it had never been seen, so R2/RMSE are honest and unbiased.
//   - Bayesian Optimization (BO Init + Next Sample) proposes the next experiment by
//     balancing exploration of uncertain regions against exploitation of the current
//     best, using the trained DIM-GP surface as the surrogate.
//   - The Web App Export wraps the trained DIM-GP in interactive sliders so any
//     colleague can query the model without re-running the workflow.
//
// v2 additions (per the studio contract, section v2-E):
//   - `branch`: the STEP 5 per-industry differentiator. Each industry analyzes its
//     model with a different real Stochos readout: paint reads Correlations, chemistry
//     reads Sobol Indices (a tornado), engineering runs a Pareto Optimize. The `kind`
//     selects the chart drawn by studio-charts.js; `story` is the story-banner beat.
//   - `beat` on every step: a one-line, present-tense, industry-specific narrative that
//     fires in the story banner when the node is placed and wired. These carry the story.
//   - `slot` on every step: the ghost-slot label shown on the blueprint canvas.
//
// Honesty rules baked into the copy:
//   - The datasets here are synthetic and illustrative. No line claims a benchmark or
//     a real product result, and no line compares STOCHOS to anything.
//   - STOCHOS is framed as a predictive engine (DIM-GP), not a chat assistant. It learns
//     a model from measured or simulated runs; it assumes no formula, kinetics, or solver.
//   - Field names, units and goals match app/data/<domain>.json exactly.
//   - No em dashes and no en dashes anywhere. Commas or rewrites only.

export const STORIES = {

  // =====================================================================
  // PAINT & COATINGS
  //   axes    : tio2_pct, binder_pct
  //   outputs : contrast_ratio, gloss, scrub, viscosity, cost
  //   data    : 54 measured formulations
  //   branch  : Correlations, see what trades off against what
  //   story   : hide the wall in one coat without killing scrub or blowing the cost
  // =====================================================================
  paint: {
    domain: 'paint',
    tag: 'Paint & coatings',
    outcome: 'Formulate an interior wall paint',
    pitch: 'Hide the wall in one coat without losing scrub resistance or pushing up cost.',
    accent: 'var(--accent)',
    axes: ['tio2_pct', 'binder_pct'],
    budgets: { small: 12, medium: 24, full: 0 },
    outputs: ['contrast_ratio', 'gloss', 'scrub', 'viscosity', 'cost'],
    defaultOutput: 'contrast_ratio',
    goals: {
      contrast_ratio: 'high',
      gloss: 'window',
      scrub: 'high',
      viscosity: 'window',
      cost: 'low'
    },
    steps: [
      {
        id: 'data',
        node: 'excel_reader',
        kicker: 'Step 1 of 7 · Data',
        title: 'Load your lab runs',
        slot: 'Data source',
        beat: 'Your measured tins of paint land on the canvas, each a real lab run.',
        decision: {
          key: 'budget',
          label: 'How many formulations have you measured?',
          options: [
            { value: 'small',  label: '12 runs',     hint: 'a quick screening DoE' },
            { value: 'medium', label: '24 runs',     hint: 'a fuller design space' },
            { value: 'full',   label: 'All 54 runs', hint: 'the complete dataset' }
          ]
        },
        changed: 'With fewer tins measured, the gaps between TiO2 and binder levels stay foggy.',
        why: 'STOCHOS learns the surface from your measured tins. It assumes no recipe.'
      },
      {
        id: 'target',
        node: 'train_test_split',
        kicker: 'Step 2 of 7 · Target',
        title: 'Select the output column',
        slot: 'Target',
        beat: 'Train/Test Split routes the selected output column to DIM-GP and holds back 30% of tins for validation.',
        decision: {
          key: 'output',
          label: 'Which property do you want a full surface for?',
          options: [
            { value: 'contrast_ratio', label: 'Contrast / hiding', hint: 'cover the wall in one coat' },
            { value: 'scrub',          label: 'Scrub resistance',  hint: 'survive washing and wear' },
            { value: 'gloss',          label: 'Gloss (60°)',       hint: 'hold a target sheen' },
            { value: 'viscosity',      label: 'Viscosity',         hint: 'stay in the workable band' },
            { value: 'cost',           label: 'Cost',              hint: 'keep the formula affordable' }
          ]
        },
        changed: 'The field recolors to the output you selected. DIM-GP will map the full TiO2 / binder surface for it.',
        why: 'One DIM-GP model per output column. Each fits the entire design space in one pass, all inputs and interactions.'
      },
      {
        id: 'fit',
        node: 'dimgp_regr_fit',
        kicker: 'Step 3 of 7 · Fit',
        title: 'Fit the full response surface',
        slot: 'Model',
        beat: 'DIM-GP Fit trains in one pass over all 54 measured tins. The full hiding-power surface appears on the canvas.',
        decision: {
          key: 'transform',
          label: 'Power-transform the output before fitting?',
          options: [
            { value: 'on',  label: 'On',  hint: 'recommended for skewed distributions' },
            { value: 'off', label: 'Off', hint: 'fit the raw measured values' }
          ]
        },
        changed: 'The surface fills in. Brightest in the TiO2-rich corner, where hiding power peaks.',
        why: 'DIM-GP learns the complete response surface from your runs. It assumes no formula. The fog is its calibrated uncertainty.'
      },
      {
        id: 'validate',
        node: 'pam_regr',
        kicker: 'Step 4 of 7 · Validate',
        title: 'Validate with PAM',
        slot: 'Validation',
        beat: 'PAM cross-validates the surface: it predicts each held-back tin as if it had never seen it.',
        decision: {
          key: 'ci',
          label: 'Confidence interval width to display:',
          options: [
            { value: '90', label: '90%', hint: 'tighter band, some tins will fall outside' },
            { value: '95', label: '95%', hint: 'standard engineering default' },
            { value: '99', label: '99%', hint: 'conservative, wider band' }
          ]
        },
        changed: 'Predicted vs measured scatter lines up on the diagonal. R2 and RMSE are on the held-back 30%.',
        why: 'PAM holds each tin out in turn and predicts it blind. This gives an honest, unbiased R2 with no data leakage.'
      },
      {
        id: 'objective',
        node: 'correlation_coefficients',
        kicker: 'Step 5 of 7 · Analyze',
        title: 'Read the property trade-offs',
        slot: 'Correlations',
        beat: 'Correlations across the trained surfaces reveal the tension: higher TiO2 hides better but also costs more.',
        decision: {
          key: 'goal',
          label: 'For the optimize step, which direction is better?',
          options: [
            { value: 'high',   label: 'Maximize',   hint: 'more contrast hides the wall' },
            { value: 'low',    label: 'Minimize',   hint: 'useful for cost or viscosity' },
            { value: 'window', label: 'Hit a band', hint: 'land inside a target range' }
          ]
        },
        changed: 'The correlation bars expose the real conflict: hiding, scrub and cost cannot all improve at once.',
        why: 'STOCHOS reads each output pair directly from the trained DIM-GP surfaces. No formula assumed, no guessing.'
      },
      {
        id: 'optimize',
        node: 'bayesian_opt',
        kicker: 'Step 6 of 7 · Optimize',
        title: 'Propose the next experiment',
        slot: 'Optimizer',
        beat: 'Next Sample proposes the formulation most likely to improve hiding, balancing the best region against uncertain areas.',
        decision: {
          key: 'strategy',
          label: 'Should STOCHOS explore uncertain regions, or exploit the current best?'
        },
        changed: 'New candidate formulations appear on the surface. The uncertainty fog thins where the model has sampled.',
        why: 'Bayesian optimization uses the DIM-GP surface as a surrogate and picks the next point by maximizing an acquisition function.'
      },
      {
        id: 'deploy',
        node: 'web_app_scalar',
        kicker: 'Step 7 of 7 · Deploy',
        title: 'Export as a web app',
        slot: 'Web app',
        beat: 'Web App Export packages the trained DIM-GP in a browser predictor. Anyone on the team can query it with sliders.',
        decision: null,
        changed: 'A live predictor appears: move TiO2 and binder sliders, read the predicted hiding with its confidence band.',
        why: 'The same model your lab built is now queryable by any colleague, with no access to Stochos Flow required.'
      }
    ],
    branch: {
      node: 'correlation_coefficients',
      icon: 'sobol_indices',
      label: 'Correlations',
      kind: 'correlation',
      title: 'Read the property trade-offs',
      decision: null,
      story: 'Higher TiO2 improves hiding but also raises cost and shifts scrub. The trained surfaces make that trade-off quantitative.',
      changed: 'The bars show which output pairs move together and which fight. Hiding vs cost has the strongest tension.',
      why: 'STOCHOS computes Pearson correlations directly from the trained DIM-GP surfaces over the full design grid.'
    },
    deploy: {
      appName: 'Coating Predictor',
      blurb: 'Move the two main ingredients, read hiding power with its confidence band.',
      sliders: ['tio2_pct', 'binder_pct']
    }
  },

  // =====================================================================
  // CHEMISTRY
  //   axes    : temperature, catalyst
  //   outputs : yield_pct, selectivity, cost
  //   data    : 45 measured reactions
  //   branch  : Sobol Indices, find what drives the yield
  //   story   : push yield and selectivity up while raw-material cost stays down
  // =====================================================================
  chemistry: {
    domain: 'chemistry',
    tag: 'Chemical R&D',
    outcome: 'Tune a reaction for higher yield',
    pitch: 'Push yield and selectivity up while raw-material cost stays down.',
    accent: 'var(--warm)',
    axes: ['temperature', 'catalyst'],
    budgets: { small: 12, medium: 24, full: 0 },
    outputs: ['yield_pct', 'selectivity', 'cost'],
    defaultOutput: 'yield_pct',
    goals: {
      yield_pct: 'high',
      selectivity: 'high',
      cost: 'low'
    },
    steps: [
      {
        id: 'data',
        node: 'excel_reader',
        kicker: 'Step 1 of 7 · Data',
        title: 'Load your reaction runs',
        slot: 'Data source',
        beat: 'Your run reactions drop onto the canvas, each a real temperature and catalyst pairing.',
        decision: {
          key: 'budget',
          label: 'How many reactions have you run?',
          options: [
            { value: 'small',  label: '12 runs',     hint: 'a first scouting screen' },
            { value: 'medium', label: '24 runs',     hint: 'a broader sweep' },
            { value: 'full',   label: 'All 45 runs', hint: 'the complete dataset' }
          ]
        },
        changed: 'With fewer reactions run, the space between temperature settings stays uncertain.',
        why: 'STOCHOS learns the response from your measured reactions. It assumes no kinetics.'
      },
      {
        id: 'target',
        node: 'train_test_split',
        kicker: 'Step 2 of 7 · Target',
        title: 'Select the output column',
        slot: 'Target',
        beat: 'Train/Test Split routes the chosen output column to DIM-GP and holds 30% of reactions back for validation.',
        decision: {
          key: 'output',
          label: 'Which output do you want a full surface for?',
          options: [
            { value: 'yield_pct',   label: 'Yield',            hint: 'how much product you get' },
            { value: 'selectivity', label: 'Selectivity',      hint: 'product over byproduct' },
            { value: 'cost',        label: 'Raw-material cost', hint: 'what the inputs cost you' }
          ]
        },
        changed: 'The field recolors to the output you selected. DIM-GP will map the full temperature / catalyst surface for it.',
        why: 'One DIM-GP model per output column. Each fits the entire design space in one pass, all inputs and interactions.'
      },
      {
        id: 'fit',
        node: 'dimgp_regr_fit',
        kicker: 'Step 3 of 7 · Fit',
        title: 'Fit the full response surface',
        slot: 'Model',
        beat: 'DIM-GP Fit trains in one pass over all 45 reactions. The full yield surface blooms across the temperature-catalyst plane.',
        decision: {
          key: 'transform',
          label: 'Power-transform the output before fitting?',
          options: [
            { value: 'on',  label: 'On',  hint: 'recommended for skewed distributions' },
            { value: 'off', label: 'Off', hint: 'fit the raw measured values' }
          ]
        },
        changed: 'The surface fills in. Brightest in the warm, well-catalyzed band where yield peaks.',
        why: 'DIM-GP learns the complete response surface from your reactions. It assumes no kinetics. The fog is its calibrated uncertainty.'
      },
      {
        id: 'validate',
        node: 'pam_regr',
        kicker: 'Step 4 of 7 · Validate',
        title: 'Validate with PAM',
        slot: 'Validation',
        beat: 'PAM cross-validates the surface: it predicts each held-back reaction as if it had never seen it.',
        decision: {
          key: 'ci',
          label: 'Confidence interval width to display:',
          options: [
            { value: '90', label: '90%', hint: 'tighter band, some runs will fall outside' },
            { value: '95', label: '95%', hint: 'standard engineering default' },
            { value: '99', label: '99%', hint: 'conservative, wider band' }
          ]
        },
        changed: 'Predicted vs measured scatter lines up on the diagonal. R2 and RMSE are on the held-back 30%.',
        why: 'PAM holds each reaction out in turn and predicts it blind. This gives an honest, unbiased R2 with no data leakage.'
      },
      {
        id: 'objective',
        node: 'sobol_indices',
        kicker: 'Step 5 of 7 · Analyze',
        title: 'Rank what drives the yield',
        slot: 'Sobol Indices',
        beat: 'Sobol Indices decompose the variance in the surface. Temperature towers over catalyst loading as the primary lever.',
        decision: {
          key: 'rank_output',
          label: 'Rank the input drivers for which output?',
          options: [
            { value: 'yield_pct',   label: 'Yield',       hint: 'what moves how much product you get' },
            { value: 'selectivity', label: 'Selectivity', hint: 'what moves product over byproduct' },
            { value: 'cost',        label: 'Cost',        hint: 'what moves raw-material cost' }
          ]
        },
        changed: 'The tornado bars rank each input by variance contribution. The longest bar is the lever worth acting on first.',
        why: 'Sobol indices are variance-based: STOCHOS decomposes the total swing in the output across each input and their interactions.'
      },
      {
        id: 'optimize',
        node: 'bayesian_opt',
        kicker: 'Step 6 of 7 · Optimize',
        title: 'Propose the next reaction',
        slot: 'Optimizer',
        beat: 'Next Sample proposes the next reaction to run, chasing higher yield where the surface is still uncertain.',
        decision: {
          key: 'strategy',
          label: 'Should STOCHOS explore uncertain conditions, or exploit the current best?'
        },
        changed: 'New candidate reactions appear on the surface. The uncertainty fog thins around the sampled points.',
        why: 'Bayesian optimization uses the DIM-GP surface as a surrogate and picks the next point by maximizing an acquisition function.'
      },
      {
        id: 'deploy',
        node: 'web_app_scalar',
        kicker: 'Step 7 of 7 · Deploy',
        title: 'Export as a web app',
        slot: 'Web app',
        beat: 'Web App Export packages the trained DIM-GP in a browser predictor. Any chemist can set conditions and read yield.',
        decision: null,
        changed: 'A live predictor appears: set temperature and catalyst, read predicted yield with its confidence band.',
        why: 'The same surface your lab built is now queryable by any colleague, with no access to Stochos Flow required.'
      }
    ],
    branch: {
      node: 'sobol_indices',
      icon: 'sobol_indices',
      label: 'Sobol Indices',
      kind: 'tornado',
      title: 'Rank what drives the yield',
      decision: {
        key: 'rank_output',
        label: 'Rank the input drivers for which output?',
        options: [
          { value: 'yield_pct',   label: 'Yield' },
          { value: 'selectivity', label: 'Selectivity' },
          { value: 'cost',        label: 'Cost' }
        ]
      },
      story: 'Temperature, not catalyst loading, accounts for most of the variance in yield. That is the lever to push first.',
      changed: 'The tornado bars rank each input by how much of the output variance it explains. Longest bar on top.',
      why: 'Sobol indices are variance-based: STOCHOS decomposes total output variance across each input over the trained DIM-GP surface.'
    },
    deploy: {
      appName: 'Reaction Predictor',
      blurb: 'Set temperature and catalyst loading, read yield with its confidence band.',
      sliders: ['temperature', 'catalyst']
    }
  },

  // =====================================================================
  // ENGINEERING
  //   axes    : pin_height, pin_spacing
  //   outputs : peak_temp, pressure_drop, mass
  //   data    : 48 simulated heat-sink designs
  //   branch  : Pareto Optimize, trade cooling against pressure drop
  //   story   : cool the chip to a low peak temperature with no big pressure penalty
  // =====================================================================
  engineering: {
    domain: 'engineering',
    tag: 'Engineering simulation',
    outcome: 'Design a pin-fin heat sink',
    pitch: 'Cool the chip to a low peak temperature without a heavy pressure-drop penalty.',
    accent: 'var(--accent-2)',
    axes: ['pin_height', 'pin_spacing'],
    budgets: { small: 12, medium: 24, full: 0 },
    outputs: ['peak_temp', 'pressure_drop', 'mass'],
    defaultOutput: 'peak_temp',
    goals: {
      peak_temp: 'low',
      pressure_drop: 'low',
      mass: 'low'
    },
    steps: [
      {
        id: 'data',
        node: 'excel_reader',
        kicker: 'Step 1 of 7 · Data',
        title: 'Load your simulated designs',
        slot: 'Data source',
        beat: 'Your solved heat-sink designs drop onto the canvas, each one a finished CFD run.',
        decision: {
          key: 'budget',
          label: 'How many designs have you simulated?',
          options: [
            { value: 'small',  label: '12 designs',     hint: 'a coarse first sweep' },
            { value: 'medium', label: '24 designs',     hint: 'a denser study' },
            { value: 'full',   label: 'All 48 designs', hint: 'the complete dataset' }
          ]
        },
        changed: 'With fewer designs simulated, the gaps between pin heights stay uncertain.',
        why: 'STOCHOS learns the trend from your solved designs. It replaces no solver run.'
      },
      {
        id: 'target',
        node: 'train_test_split',
        kicker: 'Step 2 of 7 · Target',
        title: 'Select the output column',
        slot: 'Target',
        beat: 'Train/Test Split routes the selected output column to DIM-GP and holds 30% of designs back for validation.',
        decision: {
          key: 'output',
          label: 'Which output do you want a full surface for?',
          options: [
            { value: 'peak_temp',     label: 'Peak temperature', hint: 'keep the chip cool' },
            { value: 'pressure_drop', label: 'Pressure drop',    hint: 'the fan power penalty' },
            { value: 'mass',          label: 'Mass',             hint: 'the metal you spend' }
          ]
        },
        changed: 'The field recolors to the output you selected. DIM-GP will map the full pin-height / pin-spacing surface for it.',
        why: 'One DIM-GP model per output column. Each fits the entire design space in one pass, all inputs and interactions.'
      },
      {
        id: 'fit',
        node: 'dimgp_regr_fit',
        kicker: 'Step 3 of 7 · Fit',
        title: 'Fit the full response surface',
        slot: 'Model',
        beat: 'DIM-GP Fit trains in one pass over all 48 simulated designs. The full peak-temperature surface appears on the canvas.',
        decision: {
          key: 'transform',
          label: 'Power-transform the output before fitting?',
          options: [
            { value: 'on',  label: 'On',  hint: 'recommended for skewed distributions' },
            { value: 'off', label: 'Off', hint: 'fit the raw simulated values' }
          ]
        },
        changed: 'The surface fills in. Darkest where tall, closely spaced pins keep the chip coolest.',
        why: 'DIM-GP learns the complete response surface from your solved designs. It replaces no solver run. The fog is its calibrated uncertainty.'
      },
      {
        id: 'validate',
        node: 'pam_regr',
        kicker: 'Step 4 of 7 · Validate',
        title: 'Validate with PAM',
        slot: 'Validation',
        beat: 'PAM cross-validates the surface: it predicts each held-back design as if it had never seen it.',
        decision: {
          key: 'ci',
          label: 'Confidence interval width to display:',
          options: [
            { value: '90', label: '90%', hint: 'tighter band, some designs will fall outside' },
            { value: '95', label: '95%', hint: 'standard engineering default' },
            { value: '99', label: '99%', hint: 'conservative, wider band' }
          ]
        },
        changed: 'Predicted vs simulated scatter lines up on the diagonal. R2 and RMSE are on the held-back 30%.',
        why: 'PAM holds each design out in turn and predicts it blind. This gives an honest, unbiased R2 with no data leakage.'
      },
      {
        id: 'objective',
        node: 'bayesian_opt_optimize',
        kicker: 'Step 5 of 7 · Analyze',
        title: 'Map the Pareto trade-off',
        slot: 'Pareto Optimize',
        beat: 'Pareto Optimize reads both surfaces and draws the front. Cooler designs cost more pressure drop.',
        decision: {
          key: 'pareto_pair',
          label: 'Which two outputs are you trading off?',
          options: [
            { value: 'peak_temp|pressure_drop', label: 'Cooling vs pressure drop', hint: 'the classic heat-sink tension' },
            { value: 'peak_temp|mass',          label: 'Cooling vs mass',          hint: 'cooler often means more metal' },
            { value: 'pressure_drop|mass',      label: 'Pressure drop vs mass',    hint: 'lighter fins, higher drop' }
          ]
        },
        changed: 'The front shows every Pareto-optimal design: you cannot improve on both outputs simultaneously from any point on it.',
        why: 'STOCHOS evaluates both DIM-GP surfaces on a design grid and identifies the non-dominated (Pareto-optimal) set.'
      },
      {
        id: 'optimize',
        node: 'bayesian_opt',
        kicker: 'Step 6 of 7 · Optimize',
        title: 'Propose the next design to simulate',
        slot: 'Optimizer',
        beat: 'Next Sample proposes the next geometry to run in the solver, chasing lower temperature where the surface is still uncertain.',
        decision: {
          key: 'strategy',
          label: 'Should STOCHOS explore uncertain geometries, or exploit the current best region?'
        },
        changed: 'New candidate designs appear on the surface. The uncertainty fog thins around the sampled points.',
        why: 'Bayesian optimization uses the DIM-GP surface as a surrogate and picks the next point by maximizing an acquisition function.'
      },
      {
        id: 'deploy',
        node: 'web_app_scalar',
        kicker: 'Step 7 of 7 · Deploy',
        title: 'Export as a web app',
        slot: 'Web app',
        beat: 'Web App Export packages the trained DIM-GP in a browser predictor. Any engineer can size a heat sink with sliders.',
        decision: null,
        changed: 'A live predictor appears: set pin height and spacing, read predicted peak temperature with its confidence band.',
        why: 'The same surface your team built is now queryable by any engineer, with no solver job and no Stochos Flow access required.'
      }
    ],
    branch: {
      node: 'bayesian_opt_optimize',
      icon: 'bo_optimize',
      label: 'Pareto Optimize',
      kind: 'pareto',
      title: 'Map the Pareto trade-off',
      decision: {
        key: 'pareto_pair',
        label: 'Which two outputs are you trading off?',
        options: [
          { value: 'peak_temp|pressure_drop', label: 'Cooling vs pressure drop' },
          { value: 'peak_temp|mass',          label: 'Cooling vs mass' },
          { value: 'pressure_drop|mass',      label: 'Pressure drop vs mass' }
        ]
      },
      story: 'Lower peak temperature and lower pressure drop are in tension. The Pareto front is the complete set of best trade-offs.',
      changed: 'The scatter plots every design from the grid. Pareto-optimal points are highlighted: nothing beats them on both objectives.',
      why: 'STOCHOS evaluates both trained DIM-GP surfaces over the full design grid and marks the non-dominated set.'
    },
    deploy: {
      appName: 'Heat Sink Predictor',
      blurb: 'Set pin height and spacing, read peak temperature with its confidence band.',
      sliders: ['pin_height', 'pin_spacing']
    }
  },

  // bottle: the engineering challenge problem (a pressure bottle), so the studio can
  // build the same case the "Beat Stochos" game hands off. Same schema as the others.
  bottle: {
    domain: 'bottle',
    tag: 'Engineering simulation',
    outcome: 'Design a bottle that holds pressure',
    pitch: 'Shape a bottle for the highest burst pressure without paying in weight or cost.',
    accent: 'var(--accent-2)',
    axes: ['height_mm', 'diameter_mm'],
    budgets: { small: 12, medium: 24, full: 0 },
    outputs: ['burst_bar', 'weight_g', 'cost_rel'],
    defaultOutput: 'burst_bar',
    goals: { burst_bar: 'high', weight_g: 'low', cost_rel: 'low' },
    steps: [
      { id: 'data', node: 'excel_reader', kicker: 'Step 1 of 7 · Data', title: 'Load your tested bottles', slot: 'Data source',
        beat: 'Your solved bottle designs drop onto the canvas, each one a finished load test.',
        decision: { key: 'budget', label: 'How many bottles have you tested?', options: [
          { value: 'small', label: '12 bottles', hint: 'a coarse first sweep' },
          { value: 'medium', label: '24 bottles', hint: 'a denser study' },
          { value: 'full', label: 'All 48 bottles', hint: 'the complete dataset' } ] },
        changed: 'With fewer bottles tested, the gaps between shapes stay uncertain.',
        why: 'STOCHOS learns the trend from your tested designs. It replaces no solver run.' },
      { id: 'target', node: 'train_test_split', kicker: 'Step 2 of 7 · Target', title: 'Select the output column', slot: 'Target',
        beat: 'Train/Test Split routes the selected output column to DIM-GP and holds 30% of bottles back for validation.',
        decision: { key: 'output', label: 'Which output do you want a full surface for?', options: [
          { value: 'burst_bar', label: 'Burst pressure', hint: 'how much pressure it holds' },
          { value: 'weight_g', label: 'Weight', hint: 'the plastic you spend' },
          { value: 'cost_rel', label: 'Material cost', hint: 'the price of the recipe' } ] },
        changed: 'The field recolors to the output you selected. DIM-GP will map the full height / diameter surface for it.',
        why: 'One DIM-GP model per output column. Each fits the entire design space in one pass, all inputs and interactions.' },
      { id: 'fit', node: 'dimgp_regr_fit', kicker: 'Step 3 of 7 · Fit', title: 'Fit the full response surface', slot: 'Model',
        beat: 'DIM-GP Fit trains in one pass over all 48 tested bottles. The full burst-pressure surface appears on the canvas.',
        decision: { key: 'transform', label: 'Power-transform the output before fitting?', options: [
          { value: 'on', label: 'On', hint: 'recommended for skewed distributions' },
          { value: 'off', label: 'Off', hint: 'fit the raw tested values' } ] },
        changed: 'The surface fills in. Brightest where a compact, stiff bottle holds the most pressure.',
        why: 'DIM-GP learns the complete response surface from your tested bottles. It assumes no mechanics formula. The fog is its calibrated uncertainty.' },
      { id: 'validate', node: 'pam_regr', kicker: 'Step 4 of 7 · Validate', title: 'Validate with PAM', slot: 'Validation',
        beat: 'PAM cross-validates the surface: it predicts each held-back bottle as if it had never seen it.',
        decision: { key: 'ci', label: 'Confidence interval width to display:', options: [
          { value: '90', label: '90%', hint: 'tighter band, some bottles will fall outside' },
          { value: '95', label: '95%', hint: 'standard engineering default' },
          { value: '99', label: '99%', hint: 'conservative, wider band' } ] },
        changed: 'Predicted vs tested scatter lines up on the diagonal. R2 and RMSE are on the held-back 30%.',
        why: 'PAM holds each bottle out in turn and predicts it blind. This gives an honest, unbiased R2 with no data leakage.' },
      { id: 'objective', node: 'bayesian_opt_optimize', kicker: 'Step 5 of 7 · Analyze', title: 'Map the Pareto trade-off', slot: 'Pareto Optimize',
        beat: 'Pareto Optimize reads both surfaces and draws the front. A stronger bottle consistently weighs more.',
        decision: { key: 'pareto_pair', label: 'Which two outputs are you trading off?', options: [
          { value: 'burst_bar|weight_g', label: 'Strength vs weight', hint: 'the central bottle design tension' },
          { value: 'burst_bar|cost_rel', label: 'Strength vs cost', hint: 'stronger often means more material' },
          { value: 'weight_g|cost_rel', label: 'Weight vs cost', hint: 'lighter material can cost more' } ] },
        changed: 'The front shows every Pareto-optimal design: you cannot improve on both objectives simultaneously from any point on it.',
        why: 'STOCHOS evaluates both DIM-GP surfaces on a design grid and identifies the non-dominated (Pareto-optimal) set.' },
      { id: 'optimize', node: 'bayesian_opt', kicker: 'Step 6 of 7 · Optimize', title: 'Propose the next bottle to test', slot: 'Optimizer',
        beat: 'Next Sample proposes the next shape to test, chasing higher burst pressure where the surface is still uncertain.',
        decision: { key: 'strategy', label: 'Should STOCHOS explore uncertain shapes, or exploit the current best region?' },
        changed: 'New candidate shapes appear on the surface. The uncertainty fog thins around the sampled points.',
        why: 'Bayesian optimization uses the DIM-GP surface as a surrogate and picks the next point by maximizing an acquisition function.' },
      { id: 'deploy', node: 'web_app_scalar', kicker: 'Step 7 of 7 · Deploy', title: 'Export as a web app', slot: 'Web app',
        beat: 'Web App Export packages the trained DIM-GP in a browser predictor. Any engineer can size a bottle with sliders.',
        decision: null,
        changed: 'A live predictor appears: set height and diameter, read predicted burst pressure with its confidence band.',
        why: 'The same surface your team built is now queryable by any engineer, with no load test and no Stochos Flow access required.' }
    ],
    branch: {
      node: 'bayesian_opt_optimize', icon: 'bo_optimize', label: 'Pareto Optimize', kind: 'pareto',
      title: 'Map the Pareto trade-off',
      decision: { key: 'pareto_pair', label: 'Which two outputs are you trading off?', options: [
        { value: 'burst_bar|weight_g', label: 'Strength vs weight' },
        { value: 'burst_bar|cost_rel', label: 'Strength vs cost' },
        { value: 'weight_g|cost_rel', label: 'Weight vs cost' } ] },
      story: 'Higher burst pressure and lower weight are in tension. The Pareto front is the complete set of best trade-offs.',
      changed: 'The scatter plots every design from the grid. Pareto-optimal points are highlighted: nothing beats them on both objectives.',
      why: 'STOCHOS evaluates both trained DIM-GP surfaces over the full design grid and marks the non-dominated set.'
    },
    deploy: { appName: 'Bottle Predictor', blurb: 'Set height and diameter, read burst pressure with its confidence band.', sliders: ['height_mm', 'diameter_mm'] }
  }
};
