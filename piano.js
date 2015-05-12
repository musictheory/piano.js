/*

Copyright (c) 2015 musictheory.net, LLC. (source code)
Copyright (c) 2007 Mats Helgesson (piano sounds)

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/

(function() { "use strict";

var undefined;

var sRoot     = this;
var sOldPiano = sRoot.Piano;
var sVersion  = "0.0.1";
var sContext  = null;
var sSilence  = 0.000001;


function Instrument()
{
    this.zones       = [ ];
    this.context     = null;      // The AudioContext to play into
    this.destination = null;      // A specific output node to connect to

    // Privates
    this._buffer = null;
    this._masterOffset = 0.0;
    this._performer = new Performer(this);
}


Instrument.prototype.loadAudioFile = function(path, callback)
{
    var request = new XMLHttpRequest();
    var instrument = this;

    request.open("GET", path, true);
    request.responseType = "arraybuffer";

    request.addEventListener("load", function() {
        var context = instrument._getContext();

        context.decodeAudioData(request.response, function(buffer) {
            /*
                All MP3 encoders add a delay to the start of the file
                (see http://lame.sourceforge.net/tech-FAQ.txt)

                To work around this, start our audio file with a sine wave, and
                measure the offset of the first sample > -6dB (0.5 dBFS)

                This corresponds to sample ~27-28 in the original wav
            */

            var data   = buffer.getChannelData(0);
            var actual = 0;

            for (var i = 0; i < buffer.sampleRate; i++) {
                if (data[i] > 0.5) {
                    actual = (i / buffer.sampleRate);
                    break;
                }
            }

            instrument._masterOffset = actual - (27.0 / 22050.0);
            instrument._buffer = buffer;

            callback();

        }, function(error) {
            callback(new Error(path + " could not be decoded."));
        });

    }, false);

    request.addEventListener("error", function(err) {
        callback(err);
    }, false);

    request.addEventListener("abort", function(err) {
        callback(err);
    }, false);

    request.send();
}


Instrument.prototype._getDestinationNode = function()
{
    if (this.destination) {
        return this.destination;
    } else {
        return this._getContext().destination;
    }
}


Instrument.prototype._getContext = function()
{
    if (this.context) {
        return this.context;
    
    } else if (sContext) {
        return sContext;

    } else {
        var AudioContext = window.AudioContext;
        if (!AudioContext) AudioContext = window.webkitAudioContext;
        sContext = new AudioContext();

        return sContext;
    }
}


Instrument.prototype.loadPreset = function(preset)
{
    this.zones = (preset["zones"] || [ ]).map(function(z) {
        var zone = new Zone();
        zone._loadPreset(z);
        return zone;
    });
}


Instrument.prototype.savePreset = function(preset)
{
    preset["zones"] = this.zones.map(function(zone) {
        return zone._getPreset();
    })
}


Instrument.prototype.start = function(arg0, arg1) { this._performer.start(arg0, arg1); }
Instrument.prototype.stop  = function(arg0 )      { this._performer.stop( arg0);       }


function Zone()
{
    this.key           = 0;     // The MIDI number of the source sample
    this.keyRangeStart = 0;     // The MIDI number of the start of this zone
    this.keyRangeEnd   = 0;     // The MIDI number of the end of this zone
    this.pitched       = true;  // Does this zone correspond to a pitched sound?  (Set to false for a hammer thump)

    this.offset        = 0;     // The offset in seconds from the start of the audio file to the start of the sample
    this.gain          = 1.0;   // The gain in dbFS to apply
    this.decay         = 0;     // The decay time in seconds (0 = no decay)
    this.release       = 0;     // The release time in seconds (0 = instant release)

    this.loops         = false; // Should we loop?
    this.loopStart     = 0;     // The offset in seconds from this.offset to the start of the loop
    this.loopDuration  = 0;     // The number of samples 
    this.loopRate      = 0;     // The sample rate for loopDuration
}


Zone.prototype._loadPreset = function(arr)
{
    var i = 0;

    this.key           =   arr[i++] || 0;
    this.keyRangeStart =   arr[i++] || 0;
    this.keyRangeEnd   =   arr[i++] || 0;
    this.pitched       = !!arr[i++];

    this.offset        =   arr[i++] || 0;
    this.gain          =   arr[i++] || 0;
    this.decay         =   arr[i++] || 0;
    this.release       =   arr[i++] || 0;

    this.loops         = !!arr[i++];
    this.loopStart     =   arr[i++] || 0;
    this.loopDuration  =   arr[i++] || 0;
    this.loopRate      =   arr[i++] || 0;
}


Zone.prototype._getPreset = function()
{
    return [
        this.key           || 0,
        this.keyRangeStart || 0,
        this.keyRangeEnd   || 0,
      !!this.pitched,

        this.offset        || 0,
        this.gain          || 0,
        this.decay         || 0,
        this.release       || 0,

      !!this.loops,
        this.loopStart     || 0,
        this.loopDuration  || 0,
        this.loopRate      || 0
    ];
}


function Sequence()
{
    this._notes = [ ];
}


Sequence.prototype.addNote = function(key, velocity, offset, duration)
{
    this._notes.push(new SequenceNote(key, velocity, offset, duration));
}


function SequenceNote(key, velocity, offset, duration)
{
    this.key      = key;
    this.velocity = velocity;
    this.offset   = offset;
    this.duration = duration;
}


function Performer(instrument)
{
    this._voices = [ ];
    this._instrument = instrument;
}


Performer.prototype._makeVoices = function(key, velocity, timeOffset, duration)
{
    var instrument = this._instrument;
    var voices     = this._voices;

    this._instrument.zones.forEach(function(zone) {
        if (!zone.pitched || (key < zone.keyRangeStart) || (key > zone.keyRangeEnd)) {
            return;
        }

        var voice = new Voice(key, velocity, timeOffset, instrument, zone);

        if (duration) {
            voice.stop(timeOffset + Math.min(duration))
        }

        voices.push(voice);
    });
}


Performer.prototype.start = function(arg0, arg1)
{
    if (typeof arg0 == "number") {
        this._makeVoices(arg0, arg1 || 80, 0, 0);

    } else {
        var sequence = arg0;
        var when     = arg1 || 0;

        sequence._notes.forEach(function(note) {
            this._makeVoices(note.key, note.velocity, note.offset, note.duration)
        }.bind(this));
    }
}


Performer.prototype.stop = function(arg0)
{
    var voicesToStop = [ ];
    var voicesToKeep = [ ];

    this._voices.forEach(function(voice) {
        if (arg0 === undefined || voice._key == arg0) {
            voicesToStop.push(voice);
        } else {
            voicesToKeep.push(voice);
        }
    });

    voicesToStop.forEach(function(voice) {
        voice.stop();
    });

    this._voices = voicesToKeep;
}


function Voice(key, velocity, timeOffset, instrument, zone)
{
    function getFrequency(k) {
        return Math.pow(2.0, (k - 69) / 12.0) * 440.0;
    }

    function lint(x, y, alpha) {
        return (x * (1-alpha)) + (y * alpha);
    }

    var context    = instrument._getContext();
    var output     = instrument._getDestinationNode();
    var buffer     = instrument._buffer;

    var sourceNode = context.createBufferSource();
    var decayNode  = context.createGain();
    var finalNode  = context.createGain();

    var nodes = [ sourceNode, decayNode, finalNode, output ];

    for (var i = 0, length = (nodes.length - 1); i < length; i++) {
        nodes[i].connect(nodes[i+1]);
    }

    sourceNode.buffer = buffer;
    sourceNode.playbackRate.value = getFrequency(key) / getFrequency(zone.key);

    if (zone.loops) {
        sourceNode.loopStart = zone.offset + instrument._masterOffset + zone.loopStart;
        sourceNode.loopEnd   = zone.offset + instrument._masterOffset + (zone.loopStart + (zone.loopDuration / zone.loopRate));
        sourceNode.loop      = true;
    }

    var noteStart = context.currentTime + timeOffset;
    var startGain = zone.gain * (velocity / 127.0);

    finalNode.gain.value = startGain;

    if (zone.decay) {
        var decayStart = noteStart + (zone.loopStart + (zone.loopDuration / zone.loopRate));
        var decayEnd   = decayStart + zone.decay;

        decayNode.gain.setValueAtTime(1.0, context.currentTime);
        decayNode.gain.setValueAtTime(1.0, decayStart);
        decayNode.gain.exponentialRampToValueAtTime(sSilence, decayEnd);
    }

    sourceNode.start(context.currentTime + timeOffset, zone.offset + instrument._masterOffset);

    this._key        = key;
    this._context    = context;
    this._sourceNode = sourceNode;
    this._decayNode  = decayNode;
    this._finalNode  = finalNode;

    this._gain       = startGain;
    this._release    = zone.release;
}


Voice.prototype.stop = function(arg0)
{
    var when    = (arg0 || 0);
    var release = (this._release || 0);

    var fadeStartTime = this._context.currentTime + when;
    var fadeEndTime   = fadeStartTime + release;

    if (release) {
        this._finalNode.gain.setValueAtTime(this._gain, fadeStartTime);
        this._finalNode.gain.exponentialRampToValueAtTime(sSilence, fadeEndTime);
    } else {
        this._finalNode.gain.setValueAtTime(sSilence, fadeEndTime);
    }

    setTimeout(function() {
        this._sourceNode.disconnect();
        this._decayNode.disconnect();
        this._finalNode.disconnect();

        this._sourceNode = null;
        this._decayNode  = null;
        this._finalNode  = null;
    }.bind(this), (when + release + 0.2) * 1000);
}


var Piano = {
    version: sVersion,

    noConflict: function noConflict() {
        sRoot.Piano = sOldPiano;
        return this;
    },

    Instrument: Instrument,
    Zone:       Zone,
    Sequence:   Sequence
};

if (typeof module != "undefined" && typeof module != "function") { module.exports = Piano; }
else if (typeof define === "function" && define.amd) { define(Piano); }
else { sRoot.Piano = Piano; }

}).call(this);
