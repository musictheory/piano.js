/*

Copyright (c) 2015 musictheory.net, LLC. (source code)
Copyright (c) 2003 Mats Helgesson (piano sounds)

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
    this.zones     = [ ];
    this.context   = null;      // The AudioContext to play into
    this.node      = null;      // A specific output node to connect to

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


Instrument.prototype._getOutputNode = function()
{
    if (this.node) {
        return this.node;
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
    return {
        "zones": this.zones.map(function(zone) {
            return zone._getPreset();
        })
    };
}


Instrument.prototype.start = function(arg0, arg1) { this._performer.start(arg0, arg1); }
Instrument.prototype.stop  = function(arg0 )      { this._performer.stop( arg0);       }


function Zone()
{
    this.key           = 0;     // The MIDI number of the source sample
    this.offset        = 0;     // The offset in seconds from the start of the audio file to the start of the sample
    this.loopStart     = 0;     // The offset in samples from this.offset to the start of the loop
    this.loopEnd       = 0;     // The offset in samples from this.offset to the end of the loop
    this.duration      = 0;     // Duration (for one-shot zones)
    this.gain          = 1.0;   // The gain in dbFS to apply
    this.keyRangeStart = 0;
    this.keyRangeEnd   = 0;
    this.pitched       = true;
    this.loops         = false;
    this.filters       = [ ];
    this.decay         = null;
}


Zone.prototype._loadPreset = function(arr)
{
    function num( i, d) { }
    function bool(i) { return !!arr[i]; }

    this.key           = num(0, 0);
    this.offset        = num(1, 0);
    this.loopStart     = num(2, 0);
    this.loopEnd       = num(3, 0);
    this.duration      = num(4, 0);
    this.gain          = num(5, 1);
    this.keyRangeStart = num(6, 0);
    this.keyRangeEnd   = num(7, 0);
    this.pitched       = bool(8);
    this.loops         = bool(9);
}


Zone.prototype._getPreset = function()
{
    var arr = [
        this.key       || 0,
        this.offset    || 0,
        this.loopStart || 0,
        this.loopEnd   || 0,
        this.duration  || 0,
        this.gain      || 1,
        this.keyRangeStart || 0,
        this.keyRangeEnd   || 0,
      !!this.pitched,
      !!this.loops
    ];

    arr.push()

    return arr;
}


function Filter()
{
    this.type      = "lowpass";
    this.frequency = 0;
    this.detune    = 0;
    this.Q         = 0;
    this.gain      = 0;
}


function Sequence()
{
    this.notes = [ ];
}

function SequenceNote(key, offset, duration)
{
    this.key = key;
    this.offset = offset;
    this.duration = duration;
}


function Performer(instrument)
{
    this._voices = [ ];
    this._instrument = instrument;
}


Performer.prototype._makeVoices = function(key, timeOffset, duration)
{
    var instrument = this._instrument;
    var voices     = this._voices;

    this._instrument.zones.forEach(function(zone) {
        if (!zone.pitched || (key < zone.keyRangeStart) || (key > zone.keyRangeEnd)) {
            return;
        }

        var voice = new Voice(key, timeOffset, instrument, zone);

        if (duration || zone.duration) {
            voice.stop(timeOffset + Math.min(duration, zone.duration))
        }

        voices.push(voice);
    });
}


Performer.prototype._startSequence = function(sequence, when)
{
    if (!when) when = 0;

}


Performer.prototype._stopVoice = function(key)
{
    this._voices.forEach(function(voice) {
        if (voice.key == key) {
            // Stop and remove
        }
    });
}



Performer.prototype.start = function(arg0, arg1)
{
    if (typeof arg0 == "number") {
        this._makeVoices(arg0, 0);

    } else {
        var sequence = arg0;
        var when     = arg1 || 0;

        sequence.notes.forEach(function(note) {
            // this._makeVoice(note.key, note.)
        }.bind(this));

        this._startSequence(sequence, when);
    }
}


Performer.prototype.stop = function(arg0)
{
    // var voicesToStop = [ ];

    // if (typeof key == "number") {
    //     this._stopVoice(key);
    // } else {
    //     voicesToStop = this.voices;
    // }

    // voicesToStop.forEach(function(voice) {

    // });



    // body...
}


function Voice(key, timeOffset, instrument, zone)
{
    function connect(nodes) {
        for (var i = 0, length = (nodes.length - 1); i < length; i++) {
            nodes[i].connect(nodes[i+1]);
        }
    }

    var context    = instrument._getContext();
    var output     = instrument._getOutputNode();
    var buffer     = instrument._buffer;

    var sourceNode = context.createBufferSource();
    var decayNode  = context.createGain();
    var finalNode  = context.createGain();

    var nodes = [ sourceNode, decayNode ];

    (zone.filters || [ ]).forEach(function(filter) {
        var filterNode = context.createBiquadFilter();

        filterNode.type            = filter.type;
        filterNode.frequency.value = filter.frequency;
        filterNode.detune.value    = filter.detune;
        filterNode.Q.value         = filter.Q;
        filterNode.gain.value      = filter.gain;

        nodes.push(filterNode);
    });

    nodes.push(finalNode);

    connect(nodes);
    finalNode.connect(output);

    sourceNode.buffer = buffer;

    if (zone.loops) {
        sourceNode.loopStart = zone.offset + instrument._masterOffset + (zone.loopStart / buffer.sampleRate);
        sourceNode.loopEnd   = zone.offset + instrument._masterOffset + (zone.loopEnd   / buffer.sampleRate);
        sourceNode.loop      = true;
    }

    decayNode.gain.value = zone.gain;
    if (zone.decay) {
        var decay0Duration = zone.decay[0];
        var decay0Target   = zone.decay[1];
        var decay1Duration = zone.decay[2];
        var decay1Target   = zone.decay[3];

        var decay0Start = context.currentTime + timeOffset;
        var decay0End   = decay0Start + decay0Duration;

        decayNode.gain.setValueAtTime(zone.gain, decay0Start);
        decayNode.gain.exponentialRampToValueAtTime(zone.gain * decay1Target, decay0End);

        // Is this a compound decay, if so, do a linear ramp
        if (decay1Duration) {
            decayNode.gain.exponentialRampToValueAtTime(decay1Target, decay0End + decay1Duration);
        }
    }

    sourceNode.start(context.currentTime + timeOffset, zone.offset + instrument._masterOffset, zone.duration);

    this._sourceNode = sourceNode;
    this._finalNode  = finalNode;
}


Voice.prototype.stop = function(when)
{
    this._finalNode.setValueAtTime(sSilence)
    this._finalNode.setValueAtTime(sSilence, context.currentTime + when)
}



var Piano = {
    version: sVersion,

    noConflict: function noConflict() {
        sRoot.Piano = sOldPiano;
        return this;
    },

    Instrument: Instrument,
    Zone: Zone,
    Filter: Filter,
    Sequence: Sequence
};

if (typeof module != "undefined" && typeof module != "function") { module.exports = Piano; }
else if (typeof define === "function" && define.amd) { define(Piano); }
else { sRoot.Piano = Piano; }

}).call(this);
