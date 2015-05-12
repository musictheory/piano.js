#!/usr/bin/python

from __future__ import division

import loris
import math
import os
import re
import subprocess
import random
import threading
import sys



import numpy as np
import scikits.audiolab as audiolab
import scipy.signal as signal
import loris


SAMPLE_RATE = 44100.0

Durations = {
    36: 5.0,   40: 5.0,   44: 4.0,
    48: 4.0,   52: 4.0,   56: 3.0,
    60: 3.0,   64: 2.5,   68: 2.5,
    72: 2.0,   76: 1.5,   80: 1.5,
    84: 1.5
}


LoopCounts = {
    36: 2697,    38: 901,    40: 1873,    42: 1907,
    44: 1699,    46: 946,    48: 1517,    50: 901,
    52: 1873,    54: 2503,   56: 1699,    58: 473,
    60: 2107,    62: 901,    64: 1271,    66: 298,
    68: 1699,    70: 473,    72: 295,     74: 1314,
    76: 1572,    78: 149,    80: 1699,    82: 473,
    84: 1201,    86: 657
}


def get_frequency(midi):
    return pow(2.0, (midi - 69) / 12.0) * 440.0


def fade_in(frames):
    frames *= np.linspace(0, 1, len(frames))


def fade_out(frames, times=1):
    for i in range(0, times):
        frames *= np.linspace(1, 0, len(frames))


def db_to_dbfs(db):
    return math.pow(10.0, db / 20.0)


def read_file(path, duration=None, rate=SAMPLE_RATE):
    wav_file = path + ".wav"
    m4a_file = path + ".m4a"

    if not os.path.exists(wav_file):
        subprocess.call("/usr/bin/afconvert -f WAVE -d LEI16@44100 {0} {1}".format(m4a_file, wav_file), shell=True)

    sndfile = audiolab.Sndfile(wav_file,samplerate=rate)

    nframes = sndfile.nframes

    if duration != None:
        nframes = duration * SAMPLE_RATE

    return sndfile.read_frames(nframes, dtype=np.float64)


def write_file(path, frames, rate=SAMPLE_RATE):
    format  = audiolab.Format("wav", "pcm16")
    sndfile = audiolab.Sndfile(path,"w",format=format,channels=len(frames.shape),samplerate=rate)
    sndfile.write_frames(frames)
    sndfile.sync


def compute_stretch_factor(partials, frequency):
    harmonics = { }

    last_partial = 0
    error = 0
    for i in range(1, 20):
        found_freqs   = [ ]
        found_partials = [ ]

        for p in partials:
            if p.duration() < 0.05:
                continue

            average_freq   = loris.avgFrequency(p)
            partial_number = (average_freq / frequency)

            if (((partial_number + error) >= (i - 0.5)) and (partial_number + error) <= (i + 0.5)):
                found_partials.append(partial_number)
                found_freqs.append(average_freq)

            if len(found_freqs) > 0:
                harmonics[i] = np.average(np.array(found_freqs))
                error = i - np.average(np.array(found_partials))

    for key in xrange(20, 1, -1):
        if key in harmonics:
            return loris.Channelizer.computeStretchFactor(harmonics[1], 1, harmonics[key], key)

    return 0 



def get_looped_frames(frames, midi, loop_start_duration, loop_frame_length, output_duration=3):
    start = int(SAMPLE_RATE * loop_start_duration)
    end   = start + loop_frame_length

    samples_to_blend = loop_frame_length

    # Blend a cycle in the time domain to ensure no noise during the loop
    blend1 = frames[start - samples_to_blend:start]
    blend2 = frames[end   - samples_to_blend:end]

    for i in range(0, loop_frame_length):
        p = i / (loop_frame_length * 1.0)
        blend2[i] = (blend1[i] * p) + (blend2[i] * (1.0 - p))

    # start and end now correctly point to one loop cycle
    loop = frames[start:end]
    loop_length = len(loop)

    if loop_length == 0:
        print "loop_length is 0, start: ", start, ", end: ", end
        raise

    result_length = SAMPLE_RATE * output_duration
    result = np.zeros(result_length)
    result[0:end] = frames[0:end]

    x = end
    while (x < (result_length - loop_length)):
        result[x:x+loop_length] = loop
        x += loop_length

    return result


def merge_partials(left_partials, right_partials):
    left_map  = { }
    right_map = { }
    max_num   = 0

    out_list = loris.PartialList()

    for p in left_partials:
        num = p.label()
        left_map[num] = p
        if num > max_num: max_num = num

    for p in right_partials:
        num = p.label()
        right_map[num] = p
        if num > max_num: max_num = num

    for i in range(1, max_num + 1):
        out_partial   = None
        other_partial = None

        if i in left_map and i in right_map:
            out_partial   = loris.Partial(left_map[i])
            other_partial = right_map[i]
        elif i in left_map:
            out_partial   = loris.Partial(left_map[i])
        elif i in right_map:
            out_partial   = loris.Partial(right_map[i])
        else:
            continue

        env = loris.LinearEnvelope()
        if other_partial:
            for bp in other_partial:
                time = bp.time()
                env.insert(time, bp.amplitude())

        for bp in out_partial:
            amp = bp.amplitude() + env.valueAt(bp.time())
            bp.setAmplitude(amp / 2)

        out_list.append(out_partial)

    return out_list


def get_lower_partials(partials, crossover):
    result = loris.PartialList(partials)

    for p in result:
        if (p.label() > crossover):
            result.remove(p)

    return result


def get_higher_partials(partials, crossover):
    result = loris.PartialList(partials)

    for p in result:
        if (p.label() <= crossover):
            result.remove(p)

    return result


def get_frames_without_partials(frames, partials):
    to_remove = np.array(loris.synthesize(partials, SAMPLE_RATE))
    to_remove *= -1

    return get_combined_frames(frames, to_remove)


def get_combined_frames(frames1, frames2):
    result = np.zeros(max(len(frames1), len(frames2)))

    result[:len(frames1)] += frames1[:len(frames1)]
    result[:len(frames2)] += frames2[:len(frames2)]

    return result


def make_stereo(left, right):
    lower_len = min(len(left), len(right))

    result = np.zeros((lower_len, 2))
    result[:,0] = left[:lower_len]
    result[:,1] = right[:lower_len]

    return result


def make_loop_partials(partials, loop_start):
    result = loris.PartialList(partials)

    amps = { }
    for p in partials:
        amps[p.label()] = p.amplitudeAt(loop_start)

    for p in result:
        amp = amps[p.label()]
        for bp in p:
            bp.setAmplitude(amp)

    return result



def read(midi, crossover=0, fade_start=0):
    frequency  = get_frequency(midi)
    loop_start = Durations[midi] - 0.3

    def get_partials(frames):
        analyzer = loris.Analyzer(0.8 * frequency, frequency);
        analyzer.setFreqDrift(0.48 * frequency);  
        
        partials = analyzer.analyze(frames, SAMPLE_RATE); 

        stretch = compute_stretch_factor(partials, frequency)
        if (stretch < 0): stretch = 0

#        loris.resample(partials, 0.01)
        loris.Channelizer(frequency, stretch).channelize(partials)
        loris.distill(partials)

        return partials

    def crop_and_extend(partials):
        loris.crop(partials, 0, loop_start)

        for p in partials:
            last = p.last()
            p.insert(loop_start + 6, loris.Breakpoint(last.frequency(), last.amplitude(), 0))

    # Read file into frames
    noise_frames = read_file("./Input/noise-%s" % midi, rate=SAMPLE_RATE)
    tonal_frames = read_file("./Input/tonal-%s" % midi, rate=SAMPLE_RATE)

    tonal_frames = tonal_frames[:SAMPLE_RATE * math.ceil(loop_start + 1)]
    left_frames  = tonal_frames[:,0]
    right_frames = tonal_frames[:,1]

    # Get partials for left and right frames
    left_all_partials  = get_partials(left_frames)
    right_all_partials = get_partials(right_frames)

    # Retune all partials
    for p in left_all_partials:
        freq = p.label() * frequency
        for bp in p:
            bp.setBandwidth(0)
            bp.setFrequency(freq)

    for p in right_all_partials:
        freq = p.label() * frequency
        for bp in p:
            bp.setBandwidth(0)
            bp.setFrequency(freq)

    # Extract lower and higher partials into separate partial lists
    left_lower_partials   = get_lower_partials(left_all_partials,   crossover)
    right_lower_partials  = get_lower_partials(right_all_partials,  crossover)
    left_higher_partials  = get_higher_partials(left_all_partials,  crossover)
    right_higher_partials = get_higher_partials(right_all_partials, crossover)

    # Create mono signal for lower partials.
    lower_partials = merge_partials(left_lower_partials, right_lower_partials)

    crop_and_extend(lower_partials)

    # Make loop partials.  These are the lower partials, but with amplitudes frozen at the start loop point
    loop_partials = make_loop_partials(lower_partials, loop_start)
    loop_frames = np.array(loris.synthesize(loop_partials, SAMPLE_RATE))
    loop_length = LoopCounts[midi] * 2
    loop_frames = get_looped_frames(loop_frames, midi, loop_start, loop_length, output_duration=6)

    # Synthesize lower partials, combine with upper frames 
    nonloop_frames = np.array(loris.synthesize(lower_partials, SAMPLE_RATE))

    loop_start_index = int(loop_start * SAMPLE_RATE)
    lower_frames = np.zeros(len(loop_frames))
    lower_frames[:loop_start_index] = nonloop_frames[:loop_start_index]
    lower_frames[loop_start_index:] = loop_frames[loop_start_index:]

    tonal_left_frames  = np.array(loris.synthesize(left_higher_partials,  SAMPLE_RATE))
    tonal_right_frames = np.array(loris.synthesize(right_higher_partials, SAMPLE_RATE))

    fade_start = 0

    fade_start_index = int(fade_start * SAMPLE_RATE)
    loop_start_index = int(loop_start * SAMPLE_RATE)

    combined_left  = get_combined_frames(tonal_left_frames,  noise_frames[:,0])
    combined_right = get_combined_frames(tonal_right_frames, noise_frames[:,1])

    fade_out(combined_left[  fade_start_index : loop_start_index ], 2)
    fade_out(combined_right[ fade_start_index : loop_start_index ], 2)

    combined_left[  loop_start_index : ] = 0
    combined_right[ loop_start_index : ] = 0

    combined_left  = get_combined_frames(lower_frames, combined_left)
    combined_right = get_combined_frames(lower_frames, combined_right)

    # Find highest point of combined
    max_value = 0
    max_index = 0
    for i in range(0, len(combined_left)):
        if combined_left[i] > max_value:
            max_value = combined_left[i]
            max_index = i

    fade_len = 441

    combined_left  = combined_left[ max_index - fade_len:]
    combined_right = combined_right[max_index - fade_len:]

    fade_in(combined_left[:fade_len])
    fade_in(combined_right[:fade_len])

    combined = make_stereo(combined_left, combined_right)

    write_file("./Intermediate/result-%s.wav" % midi, combined, SAMPLE_RATE)


def chop_sample(sample, duration):
    fade_start = int((duration - 0.07) * SAMPLE_RATE)
    fade_end   = fade_start + 100
    end        = int(duration  * SAMPLE_RATE)

    to_fade = sample[fade_start:fade_end]
    to_fade *= np.linspace(1, 0, num=len(to_fade))
    sample[fade_end:end] = 0


def finalize():
    sample_offsets = { }

    boop_duration = 0.2
    boop = read_file("./Input/boop", rate=SAMPLE_RATE)
    boop = boop[0:(boop_duration * SAMPLE_RATE)]

    total_file_duration = 0
    for midi in xrange(36, 85, 4):
        total_file_duration += Durations[midi]

    result_length = (total_file_duration + boop_duration) * SAMPLE_RATE
    endPadding = 1024
    result_l = np.zeros(result_length + endPadding)
    result_r = np.zeros(result_length + endPadding)

    result_l[0:len(boop)] = boop
    result_r[0:len(boop)] = boop

    index = len(boop)

    time_offset = 0

    for midi in xrange(36, 85, 4):
        duration = Durations[midi]

        index = math.floor((boop_duration * SAMPLE_RATE) + (time_offset * SAMPLE_RATE))

        sample = read_file("./Intermediate/result-%s" % midi)
        sample_l = sample[:,0]
        sample_r = sample[:,1]

        chop_sample(sample_l, duration)
        chop_sample(sample_r, duration)

        length = min(int(math.floor(duration * SAMPLE_RATE)), len(sample_l))
        result_l[index:index + length] = sample_l[0:length]
        result_r[index:index + length] = sample_r[0:length]

        print midi, time_offset + boop_duration

        time_offset += duration

    output_wav = "./Output/pianojs.wav"

    result = make_stereo(result_l, result_r)
    write_file(output_wav, result, SAMPLE_RATE)

    subprocess.call("/usr/local/bin/lame --resample 22.05 -q 0 -m m -V 4 {0} {1}".format(output_wav, "./Output/pianojs_low.mp3"),  shell=True)   # Mono,   VBR=4, 22Khz
    subprocess.call("/usr/local/bin/lame --resample 22.05 -q 0 -m j -V 3 {0} {1}".format(output_wav, "./Output/pianojs_mid.mp3"),  shell=True)   # Stereo, VBR=3, 22Khz
    subprocess.call("/usr/local/bin/lame                  -q 0 -m j -V 2 {0} {1}".format(output_wav, "./Output/pianojs_high.mp3"), shell=True)   # Stereo, VBR=2, 44Khz



read(36, 9, 2.0)
read(40, 9, 2.0)
read(44, 9, 2.0)
read(48, 8, 2.0)
read(52, 7, 2.0)
read(56, 6, 1.5)
read(60, 5, 1.5)
read(64, 5, 1.5)
read(68, 4, 2.0)
read(72, 4, 1.5)
read(76, 3, 1.0)
read(80, 3, 1.0)
read(84, 2, 1.0)

finalize()