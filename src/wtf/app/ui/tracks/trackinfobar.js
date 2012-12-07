/**
 * Copyright 2012 Google, Inc. All Rights Reserved.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

/**
 * @fileoverview TracksPanel infobar control.
 *
 * @author benvanik@google.com (Ben Vanik)
 */

goog.provide('wtf.app.ui.tracks.TrackInfoBar');

goog.require('goog.soy');
goog.require('wtf');
goog.require('wtf.analysis.db.EventDataTable');
goog.require('wtf.analysis.db.ScopeEventDataEntry');
goog.require('wtf.app.ui.tracks.trackinfobar');
goog.require('wtf.events');
goog.require('wtf.events.EventType');
goog.require('wtf.events.KeyboardScope');
goog.require('wtf.ui.Control');
goog.require('wtf.ui.SearchControl');



/**
 * TracksPanel infobar control.
 *
 * @param {!wtf.app.ui.tracks.TracksPanel} tracksPanel Parent tracks panel.
 * @param {!Element} parentElement Element to display in.
 * @constructor
 * @extends {wtf.ui.Control}
 */
wtf.app.ui.tracks.TrackInfoBar = function(tracksPanel, parentElement) {
  var documentView = tracksPanel.getDocumentView();
  var dom = documentView.getDom();
  goog.base(this, parentElement, dom);

  /**
   * Parent tracks panel.
   * @type {!wtf.app.ui.tracks.TracksPanel}
   * @private
   */
  this.tracksPanel_ = tracksPanel;

  /**
   * Search text field.
   * @type {!wtf.ui.SearchControl}
   * @private
   */
  this.searchControl_ = new wtf.ui.SearchControl(
      this.getChildElement(goog.getCssName('wtfAppUiTracksPanelInfoHeader')),
      dom);
  this.registerDisposable(this.searchControl_);

  var commandManager = wtf.events.getCommandManager();
  commandManager.registerSimpleCommand(
      'filter_events', function(source, target, filterString) {
        var parsed = filter.setFromString(filterString);
        this.searchControl_.toggleError(!parsed);
        this.searchControl_.setValue(filterString);
      }, this);

  var filter = this.tracksPanel_.getFilter();
  filter.addListener(
      wtf.events.EventType.INVALIDATED,
      this.updateInfo_, this);

  this.searchControl_.addListener(
      wtf.events.EventType.INVALIDATED,
      function(newValue, oldValue) {
        commandManager.execute('filter_events', this, null, newValue);
      }, this);

  // Setup keyboard shortcuts.
  var keyboard = wtf.events.getWindowKeyboard(dom);
  var keyboardScope = new wtf.events.KeyboardScope(keyboard);
  this.registerDisposable(keyboardScope);
  keyboardScope.addShortcut('ctrl+f', function() {
    this.searchControl_.focus();
  }, this);
  keyboardScope.addShortcut('esc', function() {
    commandManager.execute('filter_events', this, null, '');
  }, this);

  // Update on database change.
  // TODO(benvanik): avoid when streaming? make incremental?
  var db = documentView.getDatabase();
  db.addListener(wtf.events.EventType.INVALIDATED, function() {
    this.updateInfo_();
  }, this);
};
goog.inherits(wtf.app.ui.tracks.TrackInfoBar, wtf.ui.Control);


/**
 * @override
 */
wtf.app.ui.tracks.TrackInfoBar.prototype.disposeInternal = function() {
  var commandManager = wtf.events.getCommandManager();
  commandManager.unregisterCommand('filter_events');
  goog.base(this, 'disposeInternal');
};


/**
 * @override
 */
wtf.app.ui.tracks.TrackInfoBar.prototype.createDom = function(dom) {
  return /** @type {!Element} */ (goog.soy.renderAsFragment(
      wtf.app.ui.tracks.trackinfobar.control, undefined, undefined, dom));
};


/**
 * Updates information based on the current filter.
 * This is called each time the filter changes.
 * @private
 */
wtf.app.ui.tracks.TrackInfoBar.prototype.updateInfo_ = function() {
  var beginTime = wtf.now();
  var documentView = this.tracksPanel_.getDocumentView();
  var db = documentView.getDatabase();

  // TODO(benvanik): only evaluate if the filter has changed
  // TODO(benvanik): cache outside of this function
  var filter = this.tracksPanel_.getFilter();
  var table = new wtf.analysis.db.EventDataTable(db);
  table.rebuild(filter);

  var updateDuration = wtf.now() - beginTime;
  //goog.global.console.log('update info', updateDuration);

  var rows = [];
  table.forEach(function(entry) {
    var eventType = entry.getEventType();
    var row = eventType.name + ': ' + entry.getCount();
    if (entry instanceof wtf.analysis.db.ScopeEventDataEntry) {
      var sumTime = Math.round(entry.getTotalTime());
      if (sumTime < 1) {
        sumTime = '<1';
      }
      var mean = Math.round(entry.getMeanTime());
      if (mean < 1) {
        mean = '<1';
      }
      row += ' ' + sumTime + 'ms ' + mean + 'ms';
      // } else if (entry instanceof wtf.analysis.db.InstanceEventDataEntry) {
    }
    rows.push(row);
  }, this);
  var infoString = rows.join('\n');

  goog.dispose(table);

  // TODO(benvanik): build a table, make clickable to filter/etc
  var contentEl = this.getChildElement(
      goog.getCssName('wtfAppUiTracksPanelInfoContent'));
  contentEl.innerText = infoString;
};
