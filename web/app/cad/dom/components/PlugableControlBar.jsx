import React, {Fragment} from 'react';
import ControlBar, {ControlBarButton} from './ControlBar';
import connect from 'ui/connect';
import Fa from 'ui/components/Fa';
import {TOKENS as UI_TOKENS} from '../uiEntryPointsPlugin';
import {TOKENS as ACTION_TOKENS} from '../../actions/actionSystemPlugin';
import {toIdAndOverrides} from "../../actions/actionRef";
import {mapActionBehavior} from "../../actions/actionButtonBehavior";
import {DEFAULT_MAPPER} from "ui/connect";
import {isMenuAction} from "../menu/menuPlugin";


export default function PlugableControlBar() {
  return <ControlBar left={<LeftGroup />} right={<RightGroup />}/>;
}

function ButtonGroup({actions}) {
  return actions.map(actionRef => { 
    let [id, overrides] = toIdAndOverrides(actionRef);
    return <ConnectedActionButton key={id} actionId={id} {...overrides}/>;
  });
}

class ActionButton extends React.Component {
  
  render() {
    let {label, cssIcons, enabled, visible, actionId, ...props} = this.props;
    if (!visible) {
      return null;
    }
    if (isMenuAction(actionId)) {
      let onClick = props.onClick;
      props.onClick = e => onClick(getMenuData(this.el));
    }
    
    return <ControlBarButton disabled={!enabled} onElement={el => this.el = el} {...props} >
      {cssIcons && <Fa fa={cssIcons} fw/>} {label}
    </ControlBarButton>;
  }
}

const BUTTON_CONNECTOR = {
  mapProps: ([actions]) => ({actions})
};

const LeftGroup = connect(ButtonGroup, UI_TOKENS.CONTROL_BAR_LEFT, BUTTON_CONNECTOR);
const RightGroup = connect(ButtonGroup, UI_TOKENS.CONTROL_BAR_RIGHT, BUTTON_CONNECTOR);


const ConnectedActionButton = connect(ActionButton,
  props => [ACTION_TOKENS.actionAppearance(props.actionId), 
            ACTION_TOKENS.actionState(props.actionId)],
  {
    mapProps: (state, props) => Object.assign(DEFAULT_MAPPER(state), props),
    mapActions: mapActionBehavior(props => props.actionId),
  }
);

function getMenuData(el) {
  //TODO: make more generic
  return {
    orientationUp: true,
    flatBottom: true,
    x: el.offsetParent.offsetParent.offsetLeft + el.offsetLeft,
    y: el.offsetParent.offsetHeight - el.offsetTop
  };
}
