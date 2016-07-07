import React from 'react';
import Navigation from './Navigation';

const Application = (props) => (
  <div>
    <Navigation location={props.location} history={props.history} />
    <div id="page" className="container-fluid">
      {props.children}
    </div>
  </div>
);

Application.propTypes = {
  location: React.PropTypes.object.isRequired,
  history: React.PropTypes.object.isRequired,
  children: React.PropTypes.object.isRequired
};

export default Application;