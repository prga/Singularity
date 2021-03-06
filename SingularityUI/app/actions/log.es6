import Q from 'q';
import Utils from 'utils';

import { fetchTasksForRequest } from './activeTasks';

let fetchData = function(taskId, path, logType, offset = undefined, length = 0, reverse = false) {
  if (logType == 'COMPRESSED') {
    let params = {
      key: path,
      length: length > 0 ? length : undefined,
      offset: offset,
      reverse: reverse
    };
    const splits = taskId.split('-');
    const requestId = splits.slice(0, splits.length - 5).join('-');
    return $.ajax(
      {url: `${ config.apiRoot }/logs/request/${ requestId }/read?${$.param(params)}`});
  } else {
    length = Math.max(length, 0); // API breaks if you request a negative length
    return $.ajax(
      {url: `${ config.apiRoot }/sandbox/${ taskId }/read?${$.param({path, length, offset})}`});
  }
};

const fetchTaskHistory = (taskId) =>
  $.ajax({url: `${ config.apiRoot }/history/task/${ taskId }`});

export const initializeUsingActiveTasks = (requestId, path, search, viewMode, logType) => (dispatch) => {
  return fetchTasksForRequest(requestId).then((tasks) => {
    const taskIds = _.sortBy(_.pluck(tasks, 'taskId'), taskId => taskId.instanceNo).map(taskId => taskId.id);
    return dispatch(initialize(requestId, path, search, taskIds, viewMode, logType));
  });
};

export const initialize = (requestId, path, search, taskIds, viewMode, logType) => (dispatch, getState) => {
  const taskIdGroups = viewMode === 'unified'
    ? [taskIds]
    : taskIds.map(taskId => [taskId]);

  dispatch(init(requestId, taskIdGroups, path, search, viewMode, logType));

  return Promise.all(taskIdGroups.map(function(taskIds, taskGroupId) {
    let taskInitPromises = taskIds.map(function(taskId) {
      let taskInitDeferred = Q.defer();
      let resolvedPath = path.replace('$TASK_ID', taskId);
      fetchData(taskId, resolvedPath, logType).done(function({offset}) {
        dispatch(initTask(taskId, offset, resolvedPath, true, false));
        return taskInitDeferred.resolve();
      })
      .error(function({status}) {
        if (status === 404) {
          dispatch(taskFileDoesNotExist(taskGroupId, taskId));
          return taskInitDeferred.resolve();
        } else if (status === 400 && logType == 'COMPRESSED') {
          dispatch(taskFileInvalidCompression(taskGroupId, taskId));
        } else {
          return taskInitDeferred.reject();
        }
      });
      return taskInitDeferred.promise;
    });

    let taskStatusPromises = taskIds.map(taskId => dispatch(updateTaskStatus(taskGroupId, taskId)));

    return Promise.all(taskInitPromises, taskStatusPromises).then(() =>
      dispatch(taskGroupFetchPrevious(taskGroupId)).then(() => dispatch(taskGroupReady(taskGroupId)))
    );
  }));
};

export const init = (requestId, taskIdGroups, path, search, viewMode, logType) =>
  ({
    requestId,
    taskIdGroups,
    path,
    search,
    viewMode,
    logType,
    type: 'LOG_INIT'
  });

export const initTask = (taskId, offset, path, exists, invalidCompression) =>
  ({
    taskId,
    offset,
    path,
    exists,
    invalidCompression,
    type: 'LOG_TASK_INIT'
  });

export const taskFileDoesNotExist = (taskGroupId, taskId) =>
  ({
    taskId,
    taskGroupId,
    type: 'LOG_TASK_FILE_DOES_NOT_EXIST'
  });

export const addTaskGroup = (taskIds, search) =>
  ({
    taskIds,
    search,
    type: 'LOG_ADD_TASK_GROUP'
  });

export const taskFileInvalidCompression = (taskGroupId, taskId) =>
  ({
    taskId,
    taskGroupId,
    type: 'LOG_TASK_FILE_INVALID_COMPRESSION'
  })
;

export const finishedLogExists = (taskId) =>
  ({
    taskId,
    type: 'LOG_FINISHED_LOG_EXISTS'
  });

export const taskGroupReady = taskGroupId =>
  ({
    taskGroupId,
    type: 'LOG_TASK_GROUP_READY'
  });

export const taskHistory = (taskGroupId, taskId, theTaskHistory) =>
  ({
    taskGroupId,
    taskId,
    taskHistory: theTaskHistory,
    type: 'LOG_TASK_HISTORY'
  });

export const getTasks = (taskGroup, tasks) => taskGroup.taskIds.map(taskId => tasks[taskId]);

export const doesFinishedLogExist = (taskIds) =>
  (dispatch, getState) => {
    taskIds.map((taskId) => {
      const actualPath = config.finishedTaskLogPath.replace('$TASK_ID', taskId);
      return fetchData(taskId, actualPath, getState().logType)
      .done(() => dispatch(finishedLogExists(taskId)));
    });
  };

export const taskFilesize = (taskId, filesize) =>
  ({
    taskId,
    filesize,
    type: 'LOG_TASK_FILESIZE'
  });

export const updateFilesizes = () => (dispatch, getState) => {
    const tasks = getState();
    for (const taskId of tasks) {
      fetchData(taskId, tasks[taskId.path]).done(({offset}) => {
        dispatch(taskFilesize(taskId, offset));
      });
    }
  };


export const taskData = (taskGroupId, taskId, data, offset, nextOffset, append, maxLines, logType) =>
  ({
    taskGroupId,
    taskId,
    data,
    offset,
    nextOffset,
    append,
    maxLines,
    logType,
    type: 'LOG_TASK_DATA'
  });

export const emptyFile = (taskGroupId, taskId) =>
  ({
    taskGroupId,
    taskId,
    type: 'LOG_FILE_EMPTY'
  })
;

export const taskGroupFetchNext = taskGroupId =>
  (dispatch, getState) => {
    const state = getState();
    const {taskGroups, logRequestLength, maxLines, logType} = state;

    const taskGroup = taskGroups[taskGroupId];
    const tasks = getTasks(taskGroup, state.tasks);

    // bail early if there's already a pending request
    if (taskGroup.pendingRequests) {
      return Promise.resolve();
    }

    dispatch({taskGroupId, type: 'LOG_REQUEST_START'});
    const promises = tasks.map(({taskId, exists, maxOffset, path, initialDataLoaded}) => {
      if (initialDataLoaded && exists !== false) {
        const xhr = fetchData(taskId, path, logType, maxOffset, logRequestLength);
        const promise = xhr.done(({data, offset, nextOffset}) => {
          if (data.length > 0) {
            nextOffset = _.isUndefined(nextOffset) ? offset + data.length : nextOffset;
            return dispatch(taskData(taskGroupId, taskId, data, offset, nextOffset, true, maxLines, logType));
          } else if (offset == 0) {
            return dispatch(emptyFile(taskGroupId, taskId));
          }
        }).error(error => Utils.ignore404(error));
        promise.taskId = taskId;
        return promise;
      }
      return Promise.resolve();
    });

    return Promise.all(promises).then(() => dispatch({taskGroupId, type: 'LOG_REQUEST_END'})).catch((error) => {
      if (error.status === 404) {
        dispatch(taskFileDoesNotExist(taskGroupId, error.taskId));
      }
      if (error.status === 400 && logType == 'COMPRESSED') {
        dispatch(taskFileInvalidCompression(taskGroupId, error.taskId))
      }
    });
  };

export const taskGroupFetchPrevious = (taskGroupId) => (dispatch, getState) => {
  const state = getState();
  const {taskGroups, logRequestLength, maxLines, logType} = state;

  const taskGroup = taskGroups[taskGroupId];
  let tasks = getTasks(taskGroup, state.tasks);

  // bail early if all tasks are at the top
  if (_.all(tasks.map((task) => task.minOffset === 0))) {
    return Promise.resolve();
  }

  // bail early if there's already a pending request
  if (taskGroup.pendingRequests) {
    return Promise.resolve();
  }

  dispatch({taskGroupId, type: 'LOG_REQUEST_START'});
  tasks = _.without(tasks, undefined);
  let promises = tasks.map(function({taskId, exists, minOffset, path, initialDataLoaded}) {
    if (minOffset > 0 && initialDataLoaded && exists !== false) {
      const requestedOffset = logType == 'COMPRESSED' ? minOffset : Math.max(minOffset - logRequestLength, 0);
      const xhr = fetchData(taskId, path, logType, requestedOffset, Math.min(logRequestLength, minOffset), true);
      return xhr.done(({data, offset, nextOffset}) => {
        if (data.length > 0) {
          if (logType === 'COMPRESSED') {
             return dispatch(taskData(taskGroupId, taskId, data, nextOffset, offset, false, maxLines, logType));
          } else {
            nextOffset = offset + data.length;
            return dispatch(taskData(taskGroupId, taskId, data, offset, nextOffset, false, maxLines, logType));
          }
        }
        return Promise.resolve();
      });
    }
    return Promise.resolve();
  });

  return Promise.all(promises).then(() => dispatch({taskGroupId, type: 'LOG_REQUEST_END'}));
};

export const updateGroups = () =>
  (dispatch, getState) =>
    getState().taskGroups.map((taskGroup, taskGroupId) => {
      if (!taskGroup.pendingRequests) {
        if (taskGroup.top) {
          return dispatch(taskGroupFetchPrevious(taskGroupId));
        }
        if (taskGroup.bottom || taskGroup.tailing) {
          return dispatch(taskGroupFetchNext(taskGroupId));
        }
        return null;
      }
      return null;
    });

export const updateTaskStatus = (taskGroupId, taskId) =>
  (dispatch) =>
    fetchTaskHistory(taskId, ['taskUpdates']).done(data => dispatch(taskHistory(taskGroupId, taskId, data)));

export const updateTaskStatuses = () =>
  (dispatch, getState) => {
    const {tasks, taskGroups} = getState();
    return taskGroups.map((taskGroup, taskGroupId) =>
      getTasks(taskGroup, tasks).map(({taskId, terminated}) => {
        if (terminated) {
          return Promise.resolve();
        }
        return dispatch(updateTaskStatus(taskGroupId, taskId));
      })
    );
  };

export const taskGroupTop = (taskGroupId, visible) =>
  (dispatch, getState) => {
    if (getState().taskGroups[taskGroupId].top !== visible) {
      dispatch({taskGroupId, visible, type: 'LOG_TASK_GROUP_TOP'});
      if (visible) {
        return dispatch(taskGroupFetchPrevious(taskGroupId));
      }
    }
    return null;
  };

export const taskGroupBottom = (taskGroupId, visible, tailing = false) =>
  (dispatch, getState) => {
    const { taskGroups, tasks } = getState();
    const taskGroup = taskGroups[taskGroupId];
    if (taskGroup.tailing !== tailing) {
      if (tailing === false || _.all(getTasks(taskGroup, tasks).map(({maxOffset, filesize}) => maxOffset >= filesize))) {
        return dispatch({taskGroupId, tailing, type: 'LOG_TASK_GROUP_TAILING'});
      }
    }
    if (taskGroup.bottom !== visible) {
      dispatch({taskGroupId, visible, type: 'LOG_TASK_GROUP_BOTTOM'});
      if (visible) {
        return dispatch(taskGroupFetchNext(taskGroupId));
      }
    }
    return null;
  };

export const clickPermalink = offset =>
  ({
    offset,
    type: 'LOG_CLICK_OFFSET_LINK'
  });

export const selectLogColor = color =>
  ({
    color,
    type: 'LOG_SELECT_COLOR'
  });

export const switchViewMode = (newViewMode) => (dispatch, getState) => {
  const { taskGroups, path, activeRequest, search, viewMode, logType } = getState();

  if (Utils.isIn(newViewMode, ['custom', viewMode])) {
    return null;
  }

  const taskIds = _.flatten(_.pluck(taskGroups, 'taskIds'));

  dispatch({viewMode: newViewMode, type: 'LOG_SWITCH_VIEW_MODE'});
  return dispatch(initialize(activeRequest.requestId, path, search, taskIds, newViewMode, logType));
};

export const setCurrentSearch = (newSearch) =>  // TODO: can we do something less heavyweight?
  (dispatch, getState) => {
    const {activeRequest, path, taskGroups, currentSearch, viewMode, logType} = getState();
    if (newSearch !== currentSearch) {
      return dispatch(initialize(activeRequest.requestId, path, newSearch, _.flatten(_.pluck(taskGroups, 'taskIds')), viewMode, logType));
    }
    return null;
  };

export const toggleTaskLog = taskId =>
  (dispatch, getState) => {
    const {search, path, tasks, viewMode, logType} = getState();
    if (taskId in tasks) {
      // only remove task if it's not the last one
      if (Object.keys(tasks).length > 1) {
        return dispatch({taskId, type: 'LOG_REMOVE_TASK'});
      }
      return null;
    }
    if (viewMode === 'split') {
      dispatch(addTaskGroup([taskId], search));
    }

    const resolvedPath = path.replace('$TASK_ID', taskId);
    return fetchData(taskId, resolvedPath, logType).done(function({offset}) {
      dispatch(initTask(taskId, offset, resolvedPath, true, false));

      return getState().taskGroups.map((taskGroup, taskGroupId) => {
        if (Utils.isIn(taskId, taskGroup.taskIds)) {
          dispatch(updateTaskStatus(taskGroupId, taskId));
          return dispatch(taskGroupFetchPrevious(taskGroupId)).then(() => dispatch(taskGroupReady(taskGroupId)));
        }
        return null;
      });
    });
  };

export const removeTaskGroup = taskGroupId =>
  (dispatch, getState) => {
    const { taskIds } = getState().taskGroups[taskGroupId];
    return dispatch({taskGroupId, taskIds, type: 'LOG_REMOVE_TASK_GROUP'});
  };

export const expandTaskGroup = taskGroupId =>
  (dispatch, getState) => {
    const { taskIds } = getState().taskGroups[taskGroupId];
    return dispatch({taskGroupId, taskIds, type: 'LOG_EXPAND_TASK_GROUP'});
  };

export const scrollToTop = taskGroupId =>
  (dispatch, getState) => {
    const { taskIds } = getState().taskGroups[taskGroupId];
    dispatch({taskGroupId, taskIds, type: 'LOG_SCROLL_TO_TOP'});
    return dispatch(taskGroupFetchNext(taskGroupId));
  };

export const scrollAllToTop = () =>
  (dispatch, getState) => {
    dispatch({type: 'LOG_SCROLL_ALL_TO_TOP'});
    return getState().taskGroups.map((taskGroup, taskGroupId) => dispatch(taskGroupFetchNext(taskGroupId)));
  };

export const scrollToBottom = taskGroupId =>
  (dispatch, getState) => {
    const { taskIds } = getState().taskGroups[taskGroupId];
    dispatch({taskGroupId, taskIds, type: 'LOG_SCROLL_TO_BOTTOM'});
    return dispatch(taskGroupFetchPrevious(taskGroupId));
  };

export const scrollAllToBottom = () =>
  (dispatch, getState) => {
    dispatch({type: 'LOG_SCROLL_ALL_TO_BOTTOM'});
    return getState().taskGroups.map((taskGroup, taskGroupId) => dispatch(taskGroupFetchPrevious(taskGroupId)));
  };

export default { initialize, initializeUsingActiveTasks, taskGroupFetchNext, taskGroupFetchPrevious, clickPermalink, updateGroups, updateTaskStatuses, updateFilesizes, taskGroupTop, taskGroupBottom, selectLogColor, switchViewMode, setCurrentSearch, toggleTaskLog, scrollToTop, scrollAllToTop, scrollToBottom, scrollAllToBottom, removeTaskGroup, expandTaskGroup };
