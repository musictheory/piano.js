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


function Instrument()
{
    this.zones     = [ ];
    this.context   = null;      // The AudioContext to play into
    this.node      = null;      // A specific output node to connect to

    // Privates
    this._buffer = null;
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
    this.decay         = 0;     // The time in seconds to -96dB
    this.gain          = 1.0;   // The gain in dbFS to apply
    this.keyRangeStart = 0;
    this.keyRangeEnd   = 0;
    this.pitched       = true;
    this.loops         = false;
    this.filters       = [ ];
}


Zone.prototype._loadPreset = function(arr)
{
    function num( i, d) { }
    function bool(i) { return !!arr[i]; }

    this.key           = num(0, 0);
    this.offset        = num(1, 0);
    this.loopStart     = num(2, 0);
    this.loopEnd       = num(3, 0);
    this.decay         = num(4, 0);
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
        this.decay     || 0,
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


Performer.prototype._makeVoices = function(key, timeOffset)
{
    var context = this._instrument._getContext();
    var output  = this._instrument._getOutputNode();
    var buffer  = this._instrument._buffer;
    var voices  = this._voices;

    function connect(nodes) {
        for (var i = 0, length = (nodes.length - 1); i < length; i++) {
            nodes[i].connect(nodes[i+1]);
        }
    }

    this._instrument.zones.forEach(function(zone) {
        console.log(zone);

        if (!zone.pitched || (key < zone.keyRangeStart) || (key > zone.keyRangeEnd)) {
            return;
        }

        var sourceNode = context.createBufferSource();
        var gainNode   = context.createGain();

        var nodes = [ sourceNode ];

        (zone.filters || [ ]).forEach(function(filter) {
            var filterNode = context.createBiquadFilter();

            filterNode.type            = filter.type;
            filterNode.frequency.value = filter.frequency;
            filterNode.detune.value    = filter.detune;
            filterNode.Q.value         = filter.Q;
            filterNode.gain.value      = filter.gain;

            nodes.push(filterNode);
        });

        nodes.push(gainNode);

        connect(nodes);

        sourceNode.connect(gainNode);
        gainNode.connect(output);

        sourceNode.buffer = buffer;

        sourceNode.start(context.currentTime + timeOffset, zone.offset);

        if (zone.looped) {
            sourceNode.loopStart = zone.offset + (noise.loopStart / sourceNode.sampleRate);
            sourceNode.loopEnd   = zone.offset + (noise.loopEnd   / sourceNode.sampleRate);
            sourceNode.loop      = true;
        }

        voices.push({
            key:    key,
            zone:   zone,
            source: sourceNode,
            gain:   gainNode
        });
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
