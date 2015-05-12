# piano.js

piano.js is a small (160-500 KB, depending on audio quality) piano virtual instrument.  It uses the [Web Audio API](http://webaudio.github.io/web-audio-api/) and works on modern versions of Chrome, Firefox, and Safari.

If you wish to 

- [Introduction](#intro)
- [Obtaining the Samples](#obtaining)
- [Preparing the Samples](#preparing)
  - [Overview](#preparing-overview)
  - [Looping](#preparing-looping)
  - [Manipulation](#preparing-manipulation)
  - [Generating](#preparing-generating)
- [Playing the Samples](#playing)
  - [Public API](#api)
- [Links](#links)

-

## <a name="intro"></a>Introduction


There are three great challenges to creating a virtual instrument for online use:

1. Obtaining legal and good-sounding instrument samples
2. Trimming down those samples (which could be 500MB-1GB of audio files) to a manageable size (less than 1MB).
3. Playing the samples in the browser




## <a name="obtaining"></a>Obtaining the Samples

A great frustration when designing a music application is obtaining legal instrument sound samples.  Almost every sample library and virtual instrument include a "you may only use these sounds as part of a musical composition" clause in the license.  While understandable, this also destroys many educational uses (online ear training apps, a tutorial video with audio examples, etc).

Thankfully, Mats Helgesson has graciously given permission to use a subset of his piano samples for this project. 


## <a name="preparing"></a>Preparing the Samples

### <a name="preparing-overview"></a>Overview

The piano is a complex instrument.  Martin Keane provides a great overview in [Understanding the complex nature of piano tone](http://www.researchgate.net/publication/239908011_Understanding_the_complex_nature_of_piano_tone).

Effectively, there are three phases to a piano sound:

1. The player presses a key, which slams a hammer into one to three strings.  This phase mostly consists of noise with little tonal content.
2. The strings begin to vibrate with tonal content.  Energy decays quickly at an exponential rate, with higher harmonics decaying faster.
3. Due to interactions with the soundboard and strings being slightly out-of-tune with each other, the first decay phase ends and a second slower decay begins.  This is called compound decay.

Below is a spectrogram illustrating #1 and #2 (The compound decay is hard to see in this image):
*IMAGE*

In the time domain, the compound decay is easier to see:
*IMAGE*

Ideally, long samples are used and all looping is done well into phase 3, with loops being 1-2 seconds long.


### <a name="preparing-looping"></a>Looping

Assuming an infinite sampling rate, seamlessly looping a sine wave is easy: find two zero crossings with the wave going in the same direction.

For finite sampling rates, this strategy will often produce good results; however, there may be a subtle click when looping.  This is caused when the sampling rate is not an integer multiple of the sine wave's frequency.  For example, a 441Hz tone at 44100Hz will have a cycle duration of 100 samples, but a 440Hz tone has a 100.227 long duration.  Hence, the phase is slightly off when we loop.

To loop this A4, we can take one of several approaches:

1. Retune it slightly.  For example, the 440Hz A4 retuned to 441Hz will result in a perfect loop at 100 samples.
2. Increase the loop duration until we achieve a perfect loop.  For 440Hz, this is 22 cycles at 2205 samples.  For some frequencies, a perfect loop may be infinitely long in duration. 
3. Increase the loop duration to some extent, then perform a linear crossfade.

We use #3 for piano.js.  The `loop_counts.py` script will calculate a sample count that gets us close to our target duration, then we will fix up the samples via crossfading to avoid the click.

This technique applies to any wave in which harmonics are integer multiples of the fundamental frequency.  If a 440Hz tone loops perfectly, so will an 880Hz tone, 1320Hz tone, etc.

Sadly, due to [inharmonicity](http://en.wikipedia.org/wiki/Inharmonicity), harmonics of piano strings are often not integer multiples of the fundamental frequency.  Our crossfade may loop the fundamental frequency perfectly, but will cause the out-of-tune harmonics to vary in amplitude (audible beating).

1. Increase the loop duration such that the beating is acceptable.  The piano's compound decay already causes natural beating.  By using a loop duration of 1-2 seconds, the beating artifacts from looping are hard to distinguish from the natural beating.
2. Retune all harmonics such that they are perfect integer multiplies.

Most piano software instruments use approach #1.  However, due to file size concerns, we don't have the luxury of adding 1-2 seconds per sample.  Hence, piano.js uses approach #2.


### <a name="preparing-manipulation"></a>Manipulation

To manipulate and generate the samples, we use a [Python](https://www.python.org) script (`samples.py`) with [NumPy](http://www.numpy.org), [SciPy](http://www.scipy.org), [Audiolab](http://cournape.github.io/audiolab/), and [Loris](http://www.cerlsoundgroup.org/Loris/).  [izotope RX4](https://www.izotope.com/en/products/audio-repair/rx) and [Audition CC](https://creative.adobe.com/products/audition) were used to prepare the samples.

1. From Mats Helgesson's 2007 Steinway D recordings, we select every C, E, and G# ranging from C2 (MIDI 36) to C6 (MIDI 84).  
2. Each sample is opened in Audition and ran through the [Voxengo PHA-979](http://www.voxengo.com/product/pha979/) plugin as well as Audition's Automatic Phase Correction plugin.
3. Each sample is then ran through RX4's Deconstruct plugin.  This breaks the sample into separate files containing the tonal and non-tonal (noise) parts.
4. The tonal file is read by Audiolab and then passed into Loris for analysis.
5. Loris returns a collection of frequency/amplitude/time/noise tuples, "channelized" to their closest harmonic number.  Each tuple is retuned to be an integer multiple of the fundamental frequency.
6. Phase information is merged for lower partials.
7. The lower partials are resynthesized into a NumPy array.  We manipulate this array to prepare for a seamless loop.
8. The higher partials are also resynthesized into a NumPy array.  A gentle fade-out is applied just prior to the loop point.
9. The noise file is read by Audiolab.
10. #7, #8, and #9 are all merged into a final NumPy array.  This array is then manipulated and looped (Up to 6 seconds.  This lets us open the intermediate file and make sure the loop sounds good).  
11. We write out this array as a .wav file.

Later, we reach each 


### <a name="preparing-generating"></a>Generating


## <a name="playing"></a>Playing the Samples

### <a name="api"></a>Public API

#### Piano.version

Returns the version of piano.js.

#### Piano.noConflict

Reverts the `Piano` global variable to its previous value and returns a reference to the `Piano` object.

#### Piano.Instrument Constructor

Creates a new `Instrument` object.

#### instrument.context

The AudioContext to use.  If null, an AudioContext will be created when needed.

#### instrument.destination

The destination AudioNode to use.  If null, `instrument.context.destination` will be used.  Usually you will want to feed piano.js's output into a limiter/compressor to prevent clipping.

#### instrument.loadAudioFile()

    instrument.loadAudioFile(path, callback)

`path` should be a URL to the `piano.mp3` file.

#### instrument.loadPreset()

    instrument.loadPreset(jsonObject)

Loads a preset.  `jsonObject` should be the contents of the `piano.json` file.

#### instrument.start()

    instrument.start(key, velocity)

Immediately starts playing a note with the specified key at the specified velocity.  If velocity is falsy, a default value of 80 is used instead.

    instrument.start(sequence, timeOffset)

Queues all notes in the specified sequence at the specified timeOffset.  If timeOffset is falsy, the sequence begins immediately.


#### instrument.stop()

    instrument.stop()

Stops all currently playing and queued notes.

    instrument.stop(key)

Stops all currently playing and queued notes with the specified key.


#### Piano.Sequence Constructor

Creates a new `Sequence` object.

#### sequence.addNote()

    sequence.addNote(key, velocity, timeOffset, duration)

Adds a note to the sequence.



## <a name="links"></a>Links

#### Articles &  Papers

* [Understanding the complex nature of piano tone](http://www.researchgate.net/publication/239908011_Understanding_the_complex_nature_of_piano_tone)
* [Inharmonicity of Piano Strings](http://www.simonhendry.co.uk/wp/wp-content/uploads/2012/08/inharmonicity.pdf)
* [The coupled motion of piano strings](https://www.speech.kth.se/music/5_lectures/weinreic/weinreic.html)
* [The Lost Art of Sampling - Part 1](http://www.soundonsound.com/sos/aug05/articles/lostscience.htm)
* [The Lost Art of Sampling - Part 2](http://www.soundonsound.com/sos/sep05/articles/lostscience.htm)
* [The Lost Art of Sampling - Part 3](http://www.soundonsound.com/sos/oct05/articles/lostscience.htm)
* [The Lost Art of Sampling - Part 4](http://www.soundonsound.com/sos/nov05/articles/lostscience.htm)
* [The Lost Art of Sampling - Part 5](http://www.soundonsound.com/sos/dec05/articles/lostscience.htm)
* [Synth Secrets - Synthesizing Pianos](http://www.soundonsound.com/sos/Oct02/articles/synthsecrets10.asp)

#### Software

* [Python](https://www.python.org)
* [NumPy](http://www.numpy.org)
* [SciPy](http://www.scipy.org)
* [Audiolab](http://cournape.github.io/audiolab/)
* [Loris](http://www.cerlsoundgroup.org/Loris/)
* [izotope RX4](https://www.izotope.com/en/products/audio-repair/rx)
* [Audition CC](https://creative.adobe.com/products/audition)
* [Voxengo PHA-979](http://www.voxengo.com/product/pha979/)
