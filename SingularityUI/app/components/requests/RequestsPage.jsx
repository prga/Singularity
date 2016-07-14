import React, { Component, PropTypes } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router';
import rootComponent from '../../rootComponent';

import {
  FetchRequestsInState,
  RemoveRequest,
  UnpauseRequest,
  RunRequest,
  ScaleRequest,
  BounceRequest,
  FetchRequestRun
} from '../../actions/api/requests';
import { FetchRequestRunHistory } from '../../actions/api/history';
import { FetchTaskFiles } from '../../actions/api/sandbox';

import UITable from '../common/table/UITable';
import RequestFilters from './RequestFilters';
import * as Cols from './Columns';

import Utils from '../../utils';
import filterSelector from '../../selectors/requests/filterSelector';

class RequestsPage extends Component {
  static propTypes = {
    state: PropTypes.string.isRequired,
    subFilter: PropTypes.string.isRequired,
    searchFilter: PropTypes.string.isRequired,
    requestsInState: PropTypes.arrayOf(PropTypes.object).isRequired,
    fetchFilter: PropTypes.func.isRequired
  };

  static propTypes = {
    requestsInState: React.PropTypes.array,
    fetchFilter: React.PropTypes.func,
    removeRequest: React.PropTypes.func,
    unpauseRequest: React.PropTypes.func,
    runNow: React.PropTypes.func,
    fetchRun: React.PropTypes.func,
    fetchRunHistory: React.PropTypes.func,
    fetchTaskFiles: React.PropTypes.func,
    scaleRequest: React.PropTypes.func,
    bounceRequest: React.PropTypes.func,
    params: React.PropTypes.object,
    router: React.PropTypes.object,
    filter: React.PropTypes.shape({
      state: React.PropTypes.string,
      subFilter: React.PropTypes.array,
      searchFilter: React.PropTypes.string
    }).isRequired
  };

  constructor(props) {
    super(props);
    this.state = {
      loading: false
    };
  }

  componentDidMount() {
    if (filterSelector({requestsInState: this.props.requestsInState, filter: this.props.filter}).length) {
      // legacy, remove asap
      Utils.fixTableColumns($(this.refs.table.getTableDOMNode()));
    }
  }

  handleFilterChange(filter) {
    const lastFilterState = this.props.filter.state;
    this.setState({
      loading: lastFilterState !== filter.state
    });

    const subFilter = filter.subFilter.length === RequestFilters.REQUEST_TYPES.length ? 'all' : filter.subFilter.join(',');
    this.props.router.push(`/requests/${filter.state}/${subFilter}/${filter.searchFilter}`);

    if (lastFilterState !== filter.state) {
      this.props.fetchFilter(filter.state).then(() => {
        this.setState({
          loading: false
        });
      });
    }
  }

  getColumns() {
    switch (this.props.filter.state) {
      case 'pending':
        return [Cols.RequestId, Cols.PendingType];
      case 'cleanup':
        return [Cols.RequestId, Cols.CleaningUser, Cols.CleaningTimestamp, Cols.CleanupType];
      case 'noDeploy':
        return [
          Cols.Starred,
          Cols.RequestId,
          Cols.Type,
          Cols.State,
          Cols.Instances,
          Cols.Schedule,
          Cols.Actions
        ];
      default:
        return [
          Cols.Starred,
          Cols.RequestId,
          Cols.Type,
          Cols.State,
          Cols.Instances,
          Cols.DeployId,
          Cols.DeployUser,
          Cols.LastDeploy,
          Cols.Schedule,
          Cols.Actions
        ];
    }
  }

  render() {
    const displayRequests = filterSelector({requestsInState: this.props.requestsInState, filter: this.props.filter});

    let table;
    if (this.state.loading) {
      table = <div className="page-loader fixed"></div>;
    } else if (!displayRequests.length) {
      table = <div className="empty-table-message"><p>No matching requests</p></div>;
    } else {
      table = (
        <UITable
          ref="table"
          data={displayRequests}
          keyGetter={(r) => (r.request ? r.request.id : r.requestId)}
        >
          {this.getColumns()}
        </UITable>
      );
    }

    return (
      <div>
        <RequestFilters
          filter={this.props.filter}
          onFilterChange={(filter) => this.handleFilterChange(filter)}
          displayRequestTypeFilters={!_.contains(['pending', 'cleanup'], this.props.filter.state)}
        />
        {table}
      </div>
    );
  }
}

function mapStateToProps(state, ownProps) {
  const requestsInState = state.api.requestsInState.data;
  const modifiedRequests = requestsInState.map((r) => {
    const hasActiveDeploy = !!(r.activeDeploy || (r.requestDeployState && r.requestDeployState.activeDeploy));
    return {
      ...r,
      hasActiveDeploy,
      canBeRunNow: r.state === 'ACTIVE' && _.contains(['SCHEDULED', 'ON_DEMAND'], r.request.requestType) && hasActiveDeploy,
      canBeScaled: _.contains(['ACTIVE', 'SYSTEM_COOLDOWN'], r.state) && hasActiveDeploy && _.contains(['WORKER', 'SERVICE'], r.request.requestType),
      id: r.request ? r.request.id : r.requestId
    };
  });
  const filter = {
    state: ownProps.params.state || 'all',
    subFilter: !ownProps.params.subFilter || ownProps.params.subFilter === 'all' ? RequestFilters.REQUEST_TYPES : ownProps.params.subFilter.split(','),
    searchFilter: ownProps.params.searchFilter || ''
  };

  return {
    requestsInState: modifiedRequests,
    filter
  };
}

function mapDispatchToProps(dispatch) {
  return {
    fetchFilter: (state) => dispatch(FetchRequestsInState.trigger(state)),
    removeRequest: (requestid, data) => dispatch(RemoveRequest.trigger(requestid, data)),
    unpauseRequest: (requestId, data) => dispatch(UnpauseRequest.trigger(requestId, data)),
    runNow: (requestId, data) => dispatch(RunRequest.trigger(requestId, data)),
    fetchRun: (...args) => dispatch(FetchRequestRun.trigger(...args)),
    fetchRunHistory: (...args) => dispatch(FetchRequestRunHistory.trigger(...args)),
    fetchTaskFiles: (...args) => {
      return dispatch(FetchTaskFiles.trigger(...args));
    },
    scaleRequest: (requestId, data) => dispatch(ScaleRequest.trigger(requestId, data)),
    bounceRequest: (requestId, data) => dispatch(BounceRequest.trigger(requestId, data))
  };
}

function refresh(props) {
  const state = props.params.state || 'all';
  return props.fetchFilter(state);
}

export default connect(mapStateToProps, mapDispatchToProps)(rootComponent(withRouter(RequestsPage), 'Requests', refresh));