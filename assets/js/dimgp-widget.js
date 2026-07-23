(function(){
'use strict';

/* ------------------------------------------------------------------ rules this file obeys
 * 1. Never draw a marker where the model did not fit. The Y-levels are discrete, so a drag snaps;
 *    the marker is rendered at the snapped level the fit actually used, never under the cursor.
 * 2. A level change is applied only once the record for it is in memory. No curve is ever drawn
 *    from a guess or an interpolation between records.
 * 3. Flat states (all measured points at the same level) have no stored record: the model reports
 *    zero uncertainty there. The band is hidden and the caption says why, rather than drawing a
 *    vanishing band or faking a floor.
 * 4. No live JS GP stand-in. If the data cannot be loaded the widget says so and draws nothing:
 *    a plain stationary GP is the very thing this page distinguishes DIM-GP from.
 * -------------------------------------------------------------------------------------------- */

var DATA_URL = '/assets/dimgp-data';
var AMBER='#FFB006', AMBER_LT='#FFCA4D', INK='#060607';
var Z95 = 1.959964;                       // stored band is the 95% half-width; /Z95 gives 1 sigma

var reduce=function(){return matchMedia('(prefers-reduced-motion: reduce)').matches;};
var cv=document.getElementById('dg-cv'),
    capEl=document.getElementById('dg-cap'), countEl=document.getElementById('dg-count'),
    srcEl=document.getElementById('dg-srctag'), hintEl=document.getElementById('dg-hint'),
    liveEl=document.getElementById('dg-live'), provEl=document.getElementById('dg-prov');

var C=null;                                // DimgpClient
var NLOC=6, NLEV=8, NG=120, LOC=[], YLEV=[];
var lev=[];                                // level per location, or -1 when unmeasured
var sel=0;                                 // keyboard cursor
var dragging=-1, dragMoved=false, loading=false, failed=false;

// ---------------------------------------------------------------- fit state + morph
var cur=null, tgt=null, morph=1, raf=0;
function zeros(){return {mu:new Float64Array(NG), hw:new Float64Array(NG), flat:true};}

/* Dither removal, measured 2026-07-23. The mean and half-width are stored as one uint8 per sample
 * against a range (muScale [-0.5, 1.5]) about 4x wider than any curve occupies, so one code step is
 * 1.07 px on the plot at a typical span and a six-point fit uses only ~81 of the 255 codes. A smooth
 * curve therefore rounds to codes one apart in a repeating pattern, and 120 straight segments turn
 * that into a sawtooth: the median |2nd difference| of the six-point fit measured EXACTLY one code
 * step, 1.07 px, with the p95 also at one step. That is rounding, not the model.
 *
 * The filter is a [1,2,1]/4 binomial kernel (zero response at Nyquist, where the dither sits) run
 * 12 times, and then CLAMPED back into the half-code-step interval around the stored value. The
 * clamp is the whole design. Smoothing alone is wrong here and was measured to be wrong: over 1,458
 * states and 5,954 markers it took the worst gap between the drawn line and a marker from 1.23 px
 * to 14.77 px, because on a sharp state the training points ARE the peaks and a blind smoother
 * shaves them off. Clamped, no sample can leave the bin its own byte decodes to, so the drawn curve
 * remains a valid dequantization of the same bytes: it cannot contradict the model, it can only
 * pick a different point inside the rounding interval that already existed.
 *
 * Measured over the same 1,458 states (px on the 370 px plot):
 *     median |2nd difference|   0.64 -> 0.05      the sawtooth, gone
 *     p95 and max |2nd diff|    unchanged         real curvature and peaks, kept
 *     marker gap median / max   0.27 / 1.23 -> 0.64 / 1.97   bounded by half a step (0.54 px)
 *
 * DRAW LAYER ONLY. dimgp-client.js stays byte-exact against the Python generator, which is what
 * roundtrip-test.js checks to 4.9e-10. Do not move this into the client, and do not read it as
 * licence for a coarser encoding: it hides quantization noise, it does not add information.
 */
function deDither(a, step){
  var n=a.length, src=a, out, p, i, h=0.5*step;
  for(p=0;p<12;p++){
    out=new Float64Array(n);
    for(i=0;i<n;i++) out[i]=0.25*src[i>0?i-1:0]+0.5*src[i]+0.25*src[i<n-1?i+1:n-1];
    src=out;
  }
  out=new Float64Array(n);
  for(i=0;i<n;i++) out[i]=Math.min(a[i]+h, Math.max(a[i]-h, src[i]));
  return out;
}

function measuredLocs(){var o=[];for(var i=0;i<NLOC;i++)if(lev[i]>=0)o.push(i);return o;}
function nMeasured(){return measuredLocs().length;}

/** curves for the current state, or a flat-line stand-in the model itself produces */
function fitNow(){
  var locs=measuredLocs();
  if(locs.length<2) return null;
  var ls=locs.map(function(i){return lev[i];});
  var allSame=ls.every(function(v){return v===ls[0];});
  if(allSame){
    // Flat data: DIM-GP returns a constant mean at that level and zero uncertainty everywhere
    // (measured, and unchanged by noise=True). No record is stored. hw stays 0 so the band is
    // simply absent, and the caption explains it.
    var f=zeros(), y=YLEV[ls[0]];
    for(var i=0;i<NG;i++)f.mu[i]=y;
    return f;
  }
  var r=C.curve(locs, ls), rec=C.record(locs, ls);
  // One code step, in the same units the curve is drawn in. Both scales are span-relative, so the
  // step shrinks with the span exactly as the stored error does.
  var span=0.1*rec.spanLevels;
  // de-dithered once per state change, not per frame: the morph mixes two curves linearly, so
  // mixing the corrected curves is the same as correcting the mix.
  return {
    mu: deDither(r.mu, span*(C.m.muScale[1]-C.m.muScale[0])/255),
    hw: deDither(r.hw, span*(C.m.hwScale[1]-C.m.hwScale[0])/255),
    id: r.id, flat:false
  };
}

function haveRecordFor(locs, ls){
  var allSame=ls.every(function(v){return v===ls[0];});
  if(allSame) return true;                 // flat needs no record
  var r=C.record(locs, ls);
  return C.has(r.id);
}

function retrain(){
  var frozen={mu:new Float64Array(NG),hw:new Float64Array(NG),flat:cur?cur.flat:true};
  if(cur&&tgt){for(var i=0;i<NG;i++){
    frozen.mu[i]=cur.mu[i]+(tgt.mu[i]-cur.mu[i])*morph;
    frozen.hw[i]=cur.hw[i]+(tgt.hw[i]-cur.hw[i])*morph;
  }}
  var next=fitNow();
  if(!next){cur=null;tgt=null;morph=1;draw();updateUI();return;}
  cur=(cur&&tgt)?frozen:next;
  tgt=next; morph=(cur===next)?1:0;
  if(!raf)raf=requestAnimationFrame(loop);
  updateUI();
}
function loop(){
  if(morph<1){morph=Math.min(1,morph+(reduce()?1:0.12));draw();raf=requestAnimationFrame(loop);}
  else{draw();raf=0;}
}

/** apply a level change only once its record is in memory (rule 2) */
var seqNo=0;
function setLevel(i, L){
  if(L<0||L>=NLEV||lev[i]===L)return;
  var trial=lev.slice(); trial[i]=L;
  var locs=[],ls=[];
  for(var k=0;k<NLOC;k++)if(trial[k]>=0){locs.push(k);ls.push(trial[k]);}
  if(locs.length>=2&&!haveRecordFor(locs,ls)){
    var seq=++seqNo;
    loading=true; draw();
    C.ensure([C.record(locs,ls).id]).then(function(){
      if(seq!==seqNo)return;                 // a later drag position superseded this one
      loading=false; lev[i]=L; retrain();
    }, recordMiss);
    return;
  }
  seqNo++;                                   // drop any request still in flight
  lev[i]=L; loading=false; retrain();
}

function prefetch(i){
  var locs=[],ls=[],idx=-1;
  for(var k=0;k<NLOC;k++)if(lev[k]>=0){if(k===i)idx=ls.length;locs.push(k);ls.push(lev[k]);}
  if(idx<0||locs.length<2)return;
  try{C.ensure(C.reachable(locs,ls,idx));}catch(e){/* prefetch is best effort */}
}

/* One record could not be fetched. The state is left exactly where the model does have a fit,
 * rather than moving a marker to a curve we do not have (rule 1). In a finished dataset this
 * cannot happen; while the generator is still running it happens constantly, so it must not be
 * fatal or the widget is untestable until the run ends. */
function recordMiss(e){
  loading=false;
  capEl.innerHTML='That configuration is not in the loaded dataset, so nothing moved.';
  if(e&&e.message)console.warn('dimgp record miss:',e.message);
  draw();
}

function fail(e){
  failed=true;
  srcEl.textContent='Engine: model output unavailable'; srcEl.className='dg-srctag dg-err';
  capEl.innerHTML='The precomputed model output could not be loaded, so there is nothing to show. '+
                  'This plots real STOCHOS results only, never a stand-in.';
  if(e&&e.message)console.warn('dimgp:',e.message);
  draw();
}

// ---------------------------------------------------------------- drawing
var PADB=30;
// The 8 levels sit in [0.15, 0.85] but a 2-point 95% band reaches well past 0 and 1. The view is
// wider than the data on purpose: the band is the point of the widget, so it gets room rather than
// being cropped flat against the frame.
var YV0=-0.18, YV1=1.18;
function fitCanvas(){
  var dpr=Math.min(devicePixelRatio||1,2),r=cv.getBoundingClientRect(),
      w=Math.max(2,r.width),h=Math.max(2,r.height);
  if(cv.width!==(w*dpr|0)||cv.height!==(h*dpr|0)){cv.width=w*dpr;cv.height=h*dpr;}
  var ctx=cv.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
  return {ctx:ctx,w:w,h:h};
}
function draw(){
  var f=fitCanvas(),ctx=f.ctx,w=f.w,h=f.h,ph=h-PADB;
  var px=function(x){return x*w;}, py=function(y){return ph-(y-YV0)/(YV1-YV0)*ph;};
  ctx.clearRect(0,0,w,h);

  // level guides: the 8 heights a point can take. Shown faintly always, lit while adjusting,
  // so the snap reads as the design it is and not as a glitch.
  var lit=(dragging>=0);
  for(var L=0;L<NLEV;L++){
    ctx.beginPath();ctx.moveTo(0,py(YLEV[L]));ctx.lineTo(w,py(YLEV[L]));
    ctx.strokeStyle=lit?'rgba(255,176,6,.13)':'rgba(255,255,255,.045)';ctx.lineWidth=1;ctx.stroke();
  }
  ctx.strokeStyle='rgba(255,255,255,.05)';
  for(var g=0;g<NLOC;g++){ctx.beginPath();ctx.moveTo(px(LOC[g]),0);ctx.lineTo(px(LOC[g]),ph);ctx.stroke();}

  if(cur&&tgt){
    var mix=function(a,b){return a+(b-a)*morph;};
    var mu=new Float64Array(NG),hw=new Float64Array(NG);
    for(var i=0;i<NG;i++){mu[i]=mix(cur.mu[i],tgt.mu[i]);hw[i]=mix(cur.hw[i],tgt.hw[i]);}
    // outer = stored 95% interval, inner = 1 sigma. Both vanish on flat states, where hw is 0.
    [[1,'rgba(255,176,6,.06)'],[1/Z95,'rgba(255,176,6,.11)']].forEach(function(band){
      ctx.beginPath();
      for(var i=0;i<NG;i++){var y=mu[i]+band[0]*hw[i];i?ctx.lineTo(px(i/(NG-1)),py(y)):ctx.moveTo(px(i/(NG-1)),py(y));}
      for(var j=NG-1;j>=0;j--)ctx.lineTo(px(j/(NG-1)),py(mu[j]-band[0]*hw[j]));
      ctx.closePath();ctx.fillStyle=band[1];ctx.fill();
    });
    // quadratics through segment midpoints, not 119 straight runs: at 880 px wide each segment is
    // 7.4 px, so any residual step reads as an elbow. The control points are the samples, so the
    // drawn line stays within an eighth of the (now sub-pixel) second difference of the data.
    ctx.beginPath();
    var X=function(i){return px(i/(NG-1));}, Y=function(i){return py(mu[i]);};
    ctx.moveTo(X(0),Y(0));
    for(var i=1;i<NG-2;i++) ctx.quadraticCurveTo(X(i),Y(i),(X(i)+X(i+1))/2,(Y(i)+Y(i+1))/2);
    ctx.quadraticCurveTo(X(NG-2),Y(NG-2),X(NG-1),Y(NG-1));
    ctx.strokeStyle=AMBER;ctx.lineWidth=2.2;ctx.lineJoin='round';
    ctx.shadowColor='rgba(255,176,6,.5)';ctx.shadowBlur=8;ctx.stroke();ctx.shadowBlur=0;
  }

  // markers and axis ticks
  for(var k=0;k<NLOC;k++){
    var lx=px(LOC[k]), on=lev[k]>=0, isSel=(k===sel), active=(k===dragging);
    if(on){
      var yy=py(YLEV[lev[k]]);
      if(active){ctx.beginPath();ctx.arc(lx,yy,11,0,Math.PI*2);ctx.fillStyle='rgba(255,176,6,.13)';ctx.fill();}
      ctx.beginPath();ctx.arc(lx,yy,5.5,0,Math.PI*2);
      ctx.fillStyle=INK;ctx.fill();
      ctx.strokeStyle=AMBER_LT;ctx.lineWidth=active?2.6:2;ctx.stroke();
    }
    // tick below the axis: click to add or remove this location
    ctx.beginPath();ctx.moveTo(lx,ph);ctx.lineTo(lx,ph+7);
    ctx.strokeStyle=on?'rgba(255,176,6,.75)':'rgba(255,176,6,.4)';ctx.lineWidth=2;ctx.stroke();
    ctx.beginPath();ctx.arc(lx,ph+15,on?3.5:2.5,0,Math.PI*2);
    ctx.fillStyle=on?'rgba(255,176,6,.75)':'rgba(255,176,6,.28)';ctx.fill();
    if(isSel){
      ctx.beginPath();ctx.arc(lx,ph+15,7,0,Math.PI*2);
      ctx.strokeStyle='rgba(255,176,6,.5)';ctx.lineWidth=1;ctx.stroke();
    }
  }

  if(loading){
    ctx.font="500 10.5px 'IBM Plex Mono',monospace";ctx.fillStyle='#6A6A64';
    ctx.fillText('LOADING MODEL OUTPUT', 14, 22);
  }
  if(failed){
    ctx.font="500 12px 'IBM Plex Mono',monospace";ctx.fillStyle='#E06B4A';
    ctx.fillText('model output unavailable', 14, 26);
  }
}

// ---------------------------------------------------------------- copy
/* Passed through probaligence-content 2026-07-23: house style (no em or en dashes, condensed,
 * numbers over adjectives), DIM-GP named as the predictive engine, no claim the data does not
 * support. In particular the six-point line does NOT say a stationary model would keep the band
 * flat: a stationary GP also pinches at its data. The honest differentiator is that the band
 * stays open where nothing was measured, so that is what it says. */
function updateUI(){
  var n=nMeasured();
  countEl.textContent=n+' of '+NLOC+' measured';
  if(failed)return;
  var msg;
  if(n<2){
    msg='Two measurements minimum. One point gives the model nothing to fit.';
  }else if(tgt&&tgt.flat){
    msg='Every point reads the same value. With no spread in the data there is no uncertainty to '+
        'estimate, so DIM-GP returns a flat line and the band is hidden. Move one point to bring it back.';
  }else{
    var avg=0;for(var i=0;i<NG;i++)avg+=tgt.hw[i];avg/=NG;
    if(n===2)msg='<b>2</b> points. The band pinches shut where you measured and opens wide everywhere else. The model states what it does not know.';
    else if(n<5)msg='<b>'+n+'</b> points. The shape is taking hold, and the band stays widest in the gaps between measurements.';
    else if(n<6)msg='<b>5</b> points. The band is tight across most of the range. Drag one and the uncertainty follows it.';
    else msg='All six measured. The band is at its tightest, and it still opens between the points: even with data across the range, the model does not claim certainty it has not earned.';
    msg+=' <span style="color:#6A6A64">(mean 95% half-width '+avg.toFixed(3)+')</span>';
  }
  capEl.innerHTML=msg;
  liveEl.textContent=n+' of '+NLOC+' measured. '+capEl.textContent;
}

// ---------------------------------------------------------------- interaction
function nearestLoc(nx){var b=0,bd=9;for(var k=0;k<NLOC;k++){var d=Math.abs(nx-LOC[k]);if(d<bd){bd=d;b=k;}}return b;}
function nearestLevel(ny){var b=0,bd=9;for(var L=0;L<NLEV;L++){var d=Math.abs(ny-YLEV[L]);if(d<bd){bd=d;b=L;}}return b;}
function pos(e){
  var r=cv.getBoundingClientRect(), ph=r.height-PADB, dy=e.clientY-r.top;
  return {nx:(e.clientX-r.left)/r.width, ny:YV0+((ph-dy)/ph)*(YV1-YV0), below:dy>ph};
}
function toggle(k){
  if(lev[k]>=0){
    if(nMeasured()<=2){
      capEl.innerHTML='Two measurements minimum. One point gives the model nothing to fit.';
      return;
    }
    lev[k]=-1;retrain();
  }else{
    setLevel(k, 3);                       // lands mid-range, then drag it
  }
}

cv.addEventListener('pointerdown',function(e){
  if(!C||failed)return;
  var p=pos(e); var k=nearestLoc(p.nx); sel=k;
  hintEl.style.opacity='0';
  if(p.below){toggle(k);draw();return;}
  dragging=k; dragMoved=false;
  cv.setPointerCapture(e.pointerId);
  prefetch(k);
  setLevel(k,nearestLevel(p.ny));
  draw();
});
cv.addEventListener('pointermove',function(e){
  if(dragging<0)return;
  var p=pos(e);
  dragMoved=true;
  setLevel(dragging,nearestLevel(p.ny));
});
function endDrag(e){
  if(dragging<0)return;
  dragging=-1;
  try{cv.releasePointerCapture(e.pointerId);}catch(_){}
  draw();
}
cv.addEventListener('pointerup',endDrag);
cv.addEventListener('pointercancel',endDrag);

cv.addEventListener('keydown',function(e){
  if(!C||failed)return;
  var k=e.key;
  if(k==='ArrowLeft'||k==='ArrowRight'){sel=(sel+(k==='ArrowLeft'?NLOC-1:1))%NLOC;draw();e.preventDefault();}
  else if(k==='ArrowUp'||k==='ArrowDown'){
    if(lev[sel]<0)setLevel(sel,3);
    else setLevel(sel,lev[sel]+(k==='ArrowUp'?1:-1));
    prefetch(sel);e.preventDefault();
  }
  else if(k===' '||k==='Enter'){toggle(sel);draw();e.preventDefault();}
});

document.getElementById('dg-all').addEventListener('click',function(){
  var want=[2,4,6,5,3,1];               // a shape worth looking at, not a flat line
  var locs=[0,1,2,3,4,5], ls=want.slice();
  loading=true;draw();
  C.ensure([C.record(locs,ls).id]).then(function(){
    loading=false;lev=want.slice();retrain();draw();
  },recordMiss);
});
document.getElementById('dg-reset').addEventListener('click',function(){
  loading=true;draw();
  C.ensure([C.record([1,4],[2,5]).id]).then(function(){
    loading=false;lev=[-1,2,-1,-1,5,-1];sel=1;retrain();
    hintEl.style.opacity='1';draw();
  },recordMiss);
});

window.addEventListener('resize',draw);

// ---------------------------------------------------------------- boot
DimgpClient.load(DATA_URL).then(function(client){
  C=client;
  NLOC=C.m.nloc; NLEV=C.m.nlev; NG=C.ng; LOC=C.m.loc; YLEV=C.m.ylev;
  lev=[]; for(var i=0;i<NLOC;i++)lev.push(-1);
  lev[1]=2; lev[4]=5; sel=1;                        // start with two points, never fewer
  var p=new URLSearchParams(location.search);       // ?s=<base9 state> for screenshots
  if(p.has('s')){
    var st=DimgpClient.decodeState(parseInt(p.get('s'),10)||0,NLOC,C.m.base);
    if(st.locs.length>=2){lev=[];for(var j=0;j<NLOC;j++)lev.push(-1);
      st.locs.forEach(function(l,q){lev[l]=st.lev[q];});}
  }
  provEl.textContent='Every configuration you can reach here was fitted offline by STOCHOS '+
    '(DIM-GP '+C.m.provenance.stochos+'), noise off, 95% interval. The browser loads the stored '+
    'result, it does not approximate it.';
  var locs=measuredLocs(), ls=locs.map(function(i){return lev[i];});
  return C.ensure(ls.every(function(v){return v===ls[0];})?[]:[C.record(locs,ls).id]).then(function(){
    srcEl.textContent='Engine: STOCHOS DIM-GP, precomputed'; srcEl.className='dg-srctag dg-real';
    retrain(); draw();
  });
}).catch(fail);

draw();
})();
