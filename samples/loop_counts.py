#!/usr/bin/python

import math

MinLoopDuration = 0.05
MaxLoopDuration = 0.15
SampleRate      = 22050
StartingNote    = 36
EndingNote      = 84

SamplesToPrint  = 10

def get_frequency(midi):
    return pow(2.0, (midi - 69) / 12.0) * 440.0



for midi in xrange(StartingNote, EndingNote + 1, 4):
    values = [ ]

    freq = get_frequency(midi)
    samples_per_cycle = SampleRate /  freq

    min_sample_count = MinLoopDuration * SampleRate
    max_sample_count = MaxLoopDuration * SampleRate

    best_err   = 0
    best_count = 0

    sample_count = 0
    while 1:
        sample_count = sample_count + samples_per_cycle

        if sample_count < min_sample_count:  continue
        if sample_count > max_sample_count:  break

        err = abs(math.fmod(sample_count, 1) - 0.5)

        values.append( ( err, sample_count ) )

    print "%s:" % midi
    values = sorted(values, key=lambda v: 1.0 - v[0])
    for i in range(0, min(SamplesToPrint, len(values))):
        sample_count = values[i][1]
        print "%.02f\t%.04f\t%d" % ( sample_count / SampleRate, sample_count, round(sample_count) )

    print

