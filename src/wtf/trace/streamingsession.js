/**
 * Copyright 2012 Google, Inc. All Rights Reserved.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

/**
 * @fileoverview Streaming recording session instance.
 *
 * @author benvanik@google.com (Ben Vanik)
 */

goog.provide('wtf.trace.StreamingSession');

goog.require('goog.asserts');
goog.require('wtf');
goog.require('wtf.io.Buffer');
goog.require('wtf.trace.Session');



/**
 * Streaming session implementation.
 * Pools buffers and writes them to streams.
 *
 * @param {!wtf.trace.TraceManager} traceManager Trace manager.
 * @param {!wtf.io.WriteStream} stream Target stream.
 * @param {Object=} opt_options Options overrides.
 * @constructor
 * @extends {wtf.trace.Session}
 */
wtf.trace.StreamingSession = function(traceManager, stream, opt_options) {
  var options = opt_options || {};
  goog.base(this, traceManager, options,
      wtf.trace.StreamingSession.DEFAULT_BUFFER_SIZE_);

  /**
   * Current stream target.
   * This is only valid when actively recording.
   * @type {!wtf.io.WriteStream}
   * @private
   */
  this.stream_ = stream;

  /**
   * A list of unused buffers.
   * @type {!Array.<!wtf.io.Buffer>}
   * @private
   */
  this.unusedBuffers_ = [];

  /**
   * Total size of the unused buffer pool.
   * This helps prevent the pool from growing over the max memory size.
   * @type {number}
   * @private
   */
  this.totalUnusedSize_ = 0;

  /**
   * Period, in ms, that the data is flushed.
   * Use 0 to prevent automatic flushing.
   * @type {number}
   * @private
   */
  this.flushIntervalMs_ = goog.isDef(options['flushIntervalMs']) ?
      Number(options['flushIntervalMs']) :
      wtf.trace.StreamingSession.DEFAULT_FLUSH_INTERVAL_MS_;

  /**
   * setInterval handle for the automatic flush timer.
   * @type {number}
   * @private
   */
  this.flushIntervalId_ = 0;

  // Determine the number of buffers to use.
  var bufferCount = Math.max(1, Math.floor(
      this.maximumMemoryUsage / this.bufferSize));

  // Allocate the buffers now.
  for (var n = 0; n < bufferCount; n++) {
    this.unusedBuffers_.push(new wtf.io.Buffer(this.bufferSize));
    this.totalUnusedSize_ += this.bufferSize;
  }

  // Start the session.
  this.startInternal();

  // Write trace header at the start of the stream.
  var buffer = this.acquireBuffer(wtf.now(), this.bufferSize);
  goog.asserts.assert(buffer);
  this.writeTraceHeader(buffer);

  // Flush immediately to ensure the target knows we are here.
  this.flush();

  // Setup a periodic flush - this ensures data streams nicely.
  if (this.flushIntervalMs_) {
    var setInterval = goog.global.setInterval['raw'] || goog.global.setInterval;
    this.flushIntervalId_ = setInterval.call(goog.global, goog.bind(function() {
      this.flush();
    }, this), this.flushIntervalMs_);
  }
};
goog.inherits(wtf.trace.StreamingSession, wtf.trace.Session);


/**
 * Default size for individual buffers.
 * Streaming sends data much more frequently and requires fewer buffers.
 * @const
 * @type {number}
 * @private
 */
wtf.trace.StreamingSession.DEFAULT_BUFFER_SIZE_ = 256 * 1024;


/**
 * Default interval between automatic flushes.
 * @const
 * @type {number}
 * @private
 */
wtf.trace.StreamingSession.DEFAULT_FLUSH_INTERVAL_MS_ = 1000;


/**
 * @override
 */
wtf.trace.StreamingSession.prototype.disposeInternal = function() {
  // Cancel timer.
  if (this.flushIntervalId_) {
    var clearInterval =
        goog.global.clearInterval['raw'] || goog.global.clearInterval;
    clearInterval.call(goog.global, this.flushIntervalId_);
  }

  // Stop the stream.
  this.stream_.flush();
  goog.dispose(this.stream_);

  goog.base(this, 'disposeInternal');
};


/**
 * Flushes any pending buffers immediately.
 * This should be called only before long periods of activity during a recording
 * session - for example, when the tab loses focus. Sessions will implicitly
 * call flush when stopping, so avoid calling it to prevent double-flushes.
 */
wtf.trace.StreamingSession.prototype.flush = function() {
  // Retire the current buffer, if any.
  if (this.currentBuffer) {
    this.retireBuffer(this.currentBuffer);
    this.currentBuffer = null;
  }

  // Flush to network.
  this.stream_.flush();

  // Allocate a new buffer. This assumes that the flush is occuring with the
  // intent of writing more. Applications that will be stopping should use
  // {@see #stop} instead.
  this.currentBuffer = this.nextBuffer();
};


/**
 * @override
 */
wtf.trace.StreamingSession.prototype.nextBuffer = function() {
  // Attempt to get a buffer from the pool.
  if (this.unusedBuffers_.length) {
    var buffer = this.unusedBuffers_.pop();
    buffer.offset = 0;
    this.totalUnusedSize_ -= buffer.capacity;
    return buffer;
  }

  // No buffer found.
  // TODO(benvanik): allow growth over maximum?
  return null;
};


/**
 * @override
 */
wtf.trace.StreamingSession.prototype.retireBuffer = function(buffer) {
  // Buffer is now full of useful data - write it out.

  // Check to see if the buffer is actually empty.
  if (!buffer.offset) {
    // No data - return to pool.
    this.unusedBuffers_.push(buffer);
    this.totalUnusedSize_ += buffer.capacity;
    return;
  }

  // Write the buffer to the stream.
  // This may be async and not allow the buffer to be reused - in that case,
  // we clean up in {@see #returnBufferCallback_}.
  var immediate = this.stream_.write(buffer, this.returnBufferCallback_, this);
  if (immediate) {
    // Buffer written immediately - return to pool.
    this.unusedBuffers_.push(buffer);
    this.totalUnusedSize_ += buffer.capacity;
  }
};


/**
 * Handles buffer returns from stream writers.
 * @param {!wtf.io.Buffer} buffer Buffer to return.
 * @private
 */
wtf.trace.StreamingSession.prototype.returnBufferCallback_ = function(buffer) {
  this.unusedBuffers_.push(buffer);
  this.totalUnusedSize_ += buffer.capacity;
};