import React from 'react';
import Section from "./section";
import cx from 'classnames';
import {ActiveLabel, Controls, getEdgeViewObjects, getInitColor, mapIterable, setViewObjectsColor, TAB} from "./utils";
import {EdgeExplorer, EdgesExplorer, LoopsExplorer} from "./shellExplorer";
import {DETECTED_EDGE, DISCARDED_EDGE, GREEN, GREEN_YELLOW, WHITE, YELLOW} from "./colors";

export default class LoopDetectionExplorer extends React.PureComponent {

  constructor() {
    super();
    this.state = {
      step: 0
    }
  }
  
  render() {
    let {loopDetection: {id, graph, steps, detectedLoops}, group3d} = this.props;

    let step = steps[this.state.step];
    let candidates = null;
    let currEdgeExplorer = null;
    if (step.type === 'NEXT_STEP_ANALYSIS') {
      candidates = step.candidates.map(c => <EdgeExplorer key={c.refId} edge={c} {...{group3d}} category='loop-detection' 
                                             customName={'candidate' + (c === step.winner ? '(winner)' : '') } />)
    } else if (step.type === 'TRY_EDGE') {
      currEdgeExplorer = <EdgeExplorer edge={step.edge} {...{group3d}} category='loop-detection' customName={'current edge'}  />
    }


    function backTrack(stepIdx) {
      let looped = new Set();
      let used = new Set();
      let active = [];
      
      for (let i = 0; i < stepIdx + 1; i++) {
        let step = steps[i];
        switch (step.type) {
          case 'TRY_LOOP': {
            if (active.length !== 0) {
              active.forEach(e => used.add(e));
              active = [];
            }
            break;
          }
          case 'TRY_EDGE': {
            active.push(step.edge);
            break;
          }
          case 'LOOP_FOUND': {
            active.forEach(e => looped.add(e));
            active = [];
            break;
          }
        }
      }
      let lastActive = active[active.length - 1]; 
      active = new Set(active);
      return {
        active, used, looped, lastActive
      }
    }
    
    function color(stepIdx) {
      let step = steps[stepIdx];
      let {active, used, looped, lastActive} = backTrack(stepIdx);
      setViewObjectsColor(getGraphViewObjects, group3d, 'loop-detection', graph, vo => {
        vo.visible = true;
        let o = vo.__tcad_debug_topoObj;
        if (step.type === 'NEXT_STEP_ANALYSIS') {
          if (step.winner === o){
            return YELLOW
          } else if (step.candidates.indexOf(o) !== -1) {
            return WHITE;
          }
        }

        if (lastActive === o) {
          return GREEN_YELLOW;
        } else if (active.has(o)) {
          return GREEN;
        } else if (looped.has(o)) {
          return DETECTED_EDGE;
        } else if (used.has(o)) {
          return DISCARDED_EDGE;
        }
        return getInitColor('loop-detection', 'HalfEdge')
      });
      __DEBUG__.render();
    }
    
     const doStep = nextStepIdx => {
      let nextStep = steps[nextStepIdx];
      if (nextStep !== undefined) {
        color(nextStepIdx);        
        this.setState({step: nextStepIdx});
      }
    };
    
    const stepNext = () => {
      doStep(this.state.step + 1);
    };

    const stepBack = () => {
      doStep(this.state.step - 1);
    };

    let ctrlProps = {
      viewObjectsProvider: getGraphViewObjects, topoObj: graph, group3d, category: 'loop-detection'
    };
    let begin = this.state.step === 0;
    let end = this.state.step === steps.length - 1;
    
    let controls = <span>
        <Controls {...ctrlProps} />
        <span className={cx({clickable: !begin, grayed: begin})} onClick={stepBack}><i className='fa fa-fw fa-caret-square-o-left' /> back</span>
        <span className={cx({clickable: !end, grayed: end})} onClick={stepNext}><i className='fa fa-fw fa-caret-square-o-right' /> next</span>
        <i> step: <b>{this.state.step || '-'}</b></i>
      </span>;

    let name = <ActiveLabel {...ctrlProps}>loop detection {id}</ActiveLabel>;

    return <Section name={name} closable defaultClosed={true} controls={controls}>
      {candidates}
      {currEdgeExplorer}
      <GraphExplorer {...{graph, group3d}} />
      <LoopsExplorer {...{group3d}} name='detected loops' loops={detectedLoops} category='loop-detection'/>
      <DiscardedExplorer {...{detectedLoops, graph}} />
    </Section>
    ;
  }
}


export function GraphExplorer({graph, group3d}) {
  let ctrlProps = {
    viewObjectsProvider: getGraphViewObjects, topoObj: graph, group3d, category: 'loop-detection'
  };
  let controls = <Controls {...ctrlProps} />;
  let name = <ActiveLabel {...ctrlProps}>graph</ActiveLabel>;

  return <Section name={name} tabs={TAB} closable defaultClosed={true} controls={controls}>
    {mapIterable(graph, edge => <EdgeExplorer key={edge.refId} {...{edge, group3d}} category='loop-detection'/>)}
  </Section>
} 


export function DiscardedExplorer({detectedLoops, graph, group3d}) {
  let discardedEdges = new Set(graph);
  for (let loop of detectedLoops) {
    for (let edge of loop.halfEdges) {
      discardedEdges.delete(edge);
    }
  }
  return (discardedEdges.size !== 0 ? <EdgesExplorer edges={Array.from(discardedEdges)} {...{group3d}} category='loop-detection' name='discarded edges' /> : null)
}


function getGraphViewObjects(group3d, category, out, graph) {
  graph.forEach(getEdgeViewObjects.bind(null, group3d, category, out));
}
