import React from 'react';
import Section from "./section";
import {
  ActiveLabel, Controls, getEdgesViewObjects, getEdgeViewObjects, getFaceViewObjects, getLoopsViewObjects,
  getLoopViewObjects,
  getVertexViewObjects, mapIterable,
  TAB
} from "./utils";

export default class ShellExplorer extends React.PureComponent {

  render() {
    let {shell, group3d} = this.props;
    
    return <div className='shell-explorer'>
      <Section name={`shell ${shell.refId}`} closable>
        {shell.faces.map(face => <FaceExplorer key={face.refId} {...{face, group3d}} category='default' />)}
      </Section>
    </div>;
  }
}

export function FaceExplorer({face, group3d, customName, category}) {
  return <LoopsExplorer loops={face.loops} {...{group3d, category}} name={getName('face', customName, face)} />
}

export function LoopsExplorer({loops, group3d, name, category}) {
  let ctrlProps = {
    viewObjectsProvider: getLoopsViewObjects, topoObj: loops, group3d, category
  };
  let controls = <Controls {...ctrlProps} />;
  let nameComp = <ActiveLabel {...ctrlProps}>{name}</ActiveLabel>;
  return <Section name={nameComp} tabs={TAB} closable defaultClosed={true} controls={controls}>
    {mapIterable(loops, loop => <LoopExplorer key={loop.refId} {...{loop, group3d, category}} />)}
  </Section>
}

export function LoopExplorer({loop, group3d, customName, category}) {
  return <EdgesExplorer edges={loop.halfEdges} {...{group3d, category}} name={getName('loop', customName, loop)} />
}

export function EdgesExplorer({edges, group3d, name, category}) {
  let ctrlProps = {
    viewObjectsProvider: getEdgesViewObjects, topoObj: edges, group3d, category
  };
  let controls = <Controls {...ctrlProps} />;
  let nameCtrl = <ActiveLabel {...ctrlProps}>{name}</ActiveLabel>;

  return <Section name={nameCtrl} tabs={TAB} closable defaultClosed={true} controls={controls}>
    {mapIterable(edges, edge => <EdgeExplorer key={edge.refId} {...{edge, group3d, category}}/>)}
  </Section>
}

export function EdgeExplorer({edge, group3d, customName, category}) {
  let ctrlProps = {
    viewObjectsProvider: getEdgeViewObjects, topoObj: edge, group3d, category
  };
  let controls = <Controls {...ctrlProps} />;
  let name = <ActiveLabel {...ctrlProps}>{getName('edge', customName, edge)}</ActiveLabel>;
  let twin = edge.twin();
  
  return <Section name={name} tabs={TAB} closable defaultClosed={true} controls={controls}>
    {twin && [
      twin.loop && [<LoopExplorer loop={twin.loop} customName='t-loop' {...{group3d, category}} />,
      twin.loop.face &&<FaceExplorer face={twin.loop.face} customName='t-face' {...{group3d, category}} />],
      <EdgeExplorer edge={twin} customName='twin' {...{group3d, category}} />
    ]}
    <VertexExplorer vertex={edge.vertexA} customName='vertex A' {...{group3d, category}} />
    <VertexExplorer vertex={edge.vertexB} customName='vertex B' {...{group3d, category}} />

  </Section>
}

export function VertexExplorer({vertex, group3d, customName, category}) {
  let ctrlProps = {
    viewObjectsProvider: getVertexViewObjects, topoObj: vertex, group3d, category
  };
  let controls = <Controls {...ctrlProps} />;
  let name = <ActiveLabel {...ctrlProps}>{getName('vertex', customName, vertex)}</ActiveLabel>;

  return <Section name={name} closable tabs={TAB} controls={controls} />
}


function getName(name, customName, topoObj) {
  return (customName || name) + ' ' + topoObj.refId;
}


