document.addEventListener('DOMContentLoaded', function () {
    const actx = new (window.AudioContext || window.webkitAudioContext)();
    const keys = document.querySelectorAll('#piano-keyboard .white-key, #piano-keyboard .black-key');

    const controls = {
        volume: document.getElementById('volume'),
        reverb: document.getElementById('reverb'),
        delay: document.getElementById('delay'),
        attack: document.getElementById('attack'),
        decay: document.getElementById('decay'),
        sustain: document.getElementById('sustain'),
        release: document.getElementById('release'),
        instrument: document.getElementById('instrument-select'),
        density: document.getElementById('density'),
        motion: document.getElementById('motion'),
        noise: document.getElementById('noise'),
        space: document.getElementById('space'),
        startDrift: document.getElementById('start-drift'),
        stopDrift: document.getElementById('stop-drift'),
        recordSeed: document.getElementById('record-seed'),
        generateScenes: document.getElementById('generate-scenes'),
        seedStatus: document.getElementById('seed-status'),
        seedSummary: document.getElementById('seed-summary'),
        sceneGrid: document.getElementById('scene-grid'),
        sceneCaption: document.getElementById('scene-caption'),
        activeSceneLabel: document.getElementById('active-scene-label')
    };

    const noteOrder = [
        'C4', 'C#4', 'D4', 'D#4', 'E4',
        'F4', 'F#4', 'G4', 'G#4', 'A4',
        'A#4', 'B4', 'C5', 'C#5', 'D5',
        'D#5', 'E5', 'F5', 'F#5', 'G5',
        'G#5', 'A5', 'A#5', 'B5', 'C6'
    ];

    const noteFrequencies = {
        'C4': 261.63, 'C#4': 277.18, 'D4': 293.66, 'D#4': 311.13, 'E4': 329.63,
        'F4': 349.23, 'F#4': 369.99, 'G4': 392.0, 'G#4': 415.3, 'A4': 440.0,
        'A#4': 466.16, 'B4': 493.88, 'C5': 523.25, 'C#5': 554.37, 'D5': 587.33,
        'D#5': 622.25, 'E5': 659.25, 'F5': 698.46, 'F#5': 739.99, 'G5': 783.99,
        'G#5': 830.61, 'A5': 880.0, 'A#5': 932.33, 'B5': 987.77, 'C6': 1046.5
    };

    const keyMap = {
        'A': 'C4', 'W': 'C#4', 'S': 'D4', 'E': 'D#4', 'D': 'E4',
        'F': 'F4', 'T': 'F#4', 'G': 'G4', 'Y': 'G#4', 'H': 'A4',
        'U': 'A#4', 'J': 'B4', 'K': 'C5', 'O': 'C#5', 'L': 'D5',
        'P': 'D#5', ';': 'E5', '\'': 'F5', ']': 'F#5', '\\': 'G5',
        '[': 'G#5', 'Z': 'A5', 'X': 'A#5', 'C': 'B5', 'V': 'C6'
    };

    const instrumentSamples = {
        piano: 'samples/piano.wav',
        guitar: 'samples/guitar.wav'
    };

    const keyElements = {};
    keys.forEach(function (key) {
        keyElements[key.getAttribute('data-note')] = key;
    });

    const state = {
        activeSources: {},
        audioBuffers: {},
        noiseBuffer: null,
        activeAmbient: null,
        scenes: [],
        currentSceneId: null,
        currentInstrument: controls.instrument.value,
        isRecordingSeed: false,
        seed: createEmptySeed()
    };

    wireControls();
    bindKeyboard();
    loadAllSamples();
    loadNoiseTexture('groove.mp3');
    generateScenes();

    function wireControls() {
        controls.instrument.addEventListener('change', function (event) {
            state.currentInstrument = event.target.value;
        });

        controls.startDrift.addEventListener('click', startDrift);
        controls.stopDrift.addEventListener('click', stopDrift);
        controls.recordSeed.addEventListener('click', toggleSeedRecording);
        controls.generateScenes.addEventListener('click', function () {
            if (state.isRecordingSeed) {
                stopSeedRecording();
            }
            generateScenes();
            setSeedStatus('Scene bank refreshed. Launch a state to hear the new contour.');
        });

        [
            controls.volume,
            controls.reverb,
            controls.delay,
            controls.density,
            controls.motion,
            controls.noise,
            controls.space
        ].forEach(function (control) {
            const eventName = control.type === 'checkbox' ? 'change' : 'input';
            control.addEventListener(eventName, applyAmbientState);
        });
    }

    function bindKeyboard() {
        keys.forEach(function (key) {
            const note = key.getAttribute('data-note');

            key.addEventListener('mousedown', function () {
                startSound(note);
            });

            key.addEventListener('mouseup', function () {
                stopSound(note);
            });

            key.addEventListener('mouseleave', function (event) {
                if (event.buttons === 1) {
                    stopSound(note);
                }
            });

            key.addEventListener('touchstart', function (event) {
                event.preventDefault();
                startSound(note);
            }, { passive: false });

            key.addEventListener('touchend', function (event) {
                event.preventDefault();
                stopSound(note);
            }, { passive: false });
        });

        document.addEventListener('keydown', function (event) {
            if (event.repeat) {
                return;
            }

            const note = keyMap[event.key.toUpperCase()];
            if (note && !state.activeSources[note]) {
                startSound(note);
            }
        });

        document.addEventListener('keyup', function (event) {
            const note = keyMap[event.key.toUpperCase()];
            if (note) {
                stopSound(note);
            }
        });

        window.addEventListener('blur', function () {
            Object.keys(state.activeSources).forEach(function (note) {
                stopSound(note);
            });
        });
    }

    function createEmptySeed() {
        return {
            startedAt: 0,
            stoppedAt: 0,
            notes: [],
            openNotes: {},
            analysis: null
        };
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function ensureAudioContext() {
        if (actx.state === 'suspended') {
            actx.resume().catch(function () {
                setSeedStatus('Audio could not start yet. Click again to unlock playback.');
            });
        }
    }

    function loadAudioBuffer(url) {
        return fetch(url)
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('Request failed for ' + url);
                }
                return response.arrayBuffer();
            })
            .then(function (data) {
                return actx.decodeAudioData(data);
            });
    }

    function loadAudioSample(instrumentName, url) {
        return loadAudioBuffer(url)
            .then(function (buffer) {
                state.audioBuffers[instrumentName] = buffer;
            })
            .catch(function () {
                console.warn('Could not load sample for', instrumentName);
            });
    }

    function loadAllSamples() {
        const samplePromises = Object.keys(instrumentSamples).map(function (instrumentName) {
            return loadAudioSample(instrumentName, instrumentSamples[instrumentName]);
        });

        Promise.all(samplePromises).catch(function () {
            console.warn('One or more samples failed to load.');
        });
    }

    function loadNoiseTexture(url) {
        loadAudioBuffer(url)
            .then(function (buffer) {
                state.noiseBuffer = buffer;
            })
            .catch(function () {
                console.warn('Could not load the white-noise texture.');
                setSeedStatus('The white-noise bed is unavailable, but the keyboard and scenes still work.');
            });
    }

    function getFrequency(note) {
        return noteFrequencies[note] || 440.0;
    }

    function getPitchClass(note) {
        return note.replace(/[0-9]/g, '');
    }

    function transposeNote(note, semitoneOffset) {
        const noteIndex = noteOrder.indexOf(note);
        if (noteIndex === -1) {
            return noteOrder[0];
        }

        const targetIndex = clamp(noteIndex + semitoneOffset, 0, noteOrder.length - 1);
        return noteOrder[targetIndex];
    }

    function getCurrentMacros() {
        return {
            density: parseFloat(controls.density.value),
            motion: parseFloat(controls.motion.value),
            noise: parseFloat(controls.noise.value),
            space: parseFloat(controls.space.value)
        };
    }

    function createImpulseResponse(duration, decay) {
        const sampleRate = actx.sampleRate;
        const length = sampleRate * duration;
        const impulse = actx.createBuffer(2, length, sampleRate);
        const impulseL = impulse.getChannelData(0);
        const impulseR = impulse.getChannelData(1);

        for (let i = 0; i < length; i += 1) {
            const envelope = Math.pow(1 - (i / length), decay);
            impulseL[i] = (Math.random() * 2 - 1) * envelope;
            impulseR[i] = (Math.random() * 2 - 1) * envelope;
        }

        return impulse;
    }

    function createPlayableSource(note) {
        if (state.currentInstrument === 'sine') {
            const oscillator = actx.createOscillator();
            oscillator.type = 'sine';
            oscillator.frequency.value = getFrequency(note);
            oscillator.start();
            return oscillator;
        }

        const sampleBuffer = state.audioBuffers[state.currentInstrument];
        if (!sampleBuffer) {
            const fallbackOscillator = actx.createOscillator();
            fallbackOscillator.type = 'triangle';
            fallbackOscillator.frequency.value = getFrequency(note);
            fallbackOscillator.start();
            return fallbackOscillator;
        }

        const sourceNode = actx.createBufferSource();
        sourceNode.buffer = sampleBuffer;
        sourceNode.playbackRate.value = getFrequency(note) / getFrequency('C4');

        if (sampleBuffer.duration > 0.35) {
            sourceNode.loop = true;
            sourceNode.loopStart = 0.05;
            sourceNode.loopEnd = Math.max(0.12, sampleBuffer.duration - 0.02);
        }

        sourceNode.start(0);
        return sourceNode;
    }

    function buildVoiceChain() {
        const macros = getCurrentMacros();
        const gainNode = actx.createGain();
        const filterNode = actx.createBiquadFilter();
        const pannerNode = actx.createStereoPanner();

        filterNode.type = 'lowpass';
        filterNode.frequency.value = 950 + (macros.space * 900) + (macros.density * 700);
        pannerNode.pan.value = (Math.random() * 0.4) - 0.2;

        gainNode.connect(filterNode);
        filterNode.connect(pannerNode);
        pannerNode.connect(actx.destination);

        if (macros.space > 0.02 || controls.reverb.checked) {
            const convolverNode = actx.createConvolver();
            const reverbGain = actx.createGain();

            convolverNode.buffer = createImpulseResponse(1.8 + (macros.space * 2.0), 2.1 + (macros.space * 1.8));
            reverbGain.gain.value = 0.05 + (macros.space * 0.16) + (controls.reverb.checked ? 0.16 : 0);

            pannerNode.connect(convolverNode);
            convolverNode.connect(reverbGain);
            reverbGain.connect(actx.destination);
        }

        if (macros.motion > 0.02 || controls.delay.checked) {
            const delayNode = actx.createDelay(1.5);
            const feedbackNode = actx.createGain();
            const delayGain = actx.createGain();

            delayNode.delayTime.value = 0.12 + (macros.motion * 0.28);
            feedbackNode.gain.value = clamp(0.08 + (macros.space * 0.14) + (controls.delay.checked ? 0.18 : 0), 0.08, 0.44);
            delayGain.gain.value = 0.04 + (macros.motion * 0.08) + (controls.delay.checked ? 0.1 : 0);

            pannerNode.connect(delayNode);
            delayNode.connect(feedbackNode);
            feedbackNode.connect(delayNode);
            delayNode.connect(delayGain);
            delayGain.connect(actx.destination);
        }

        return {
            gainNode: gainNode
        };
    }

    function startSound(note) {
        ensureAudioContext();

        if (state.activeSources[note]) {
            stopSound(note);
        }

        const sourceNode = createPlayableSource(note);
        const chain = buildVoiceChain();
        const volume = parseFloat(controls.volume.value);
        const attack = Math.max(parseFloat(controls.attack.value), 0.01);
        const decay = Math.max(parseFloat(controls.decay.value), 0.01);
        const sustain = parseFloat(controls.sustain.value);
        const keyElement = keyElements[note];

        sourceNode.connect(chain.gainNode);

        chain.gainNode.gain.setValueAtTime(0, actx.currentTime);
        chain.gainNode.gain.linearRampToValueAtTime(volume, actx.currentTime + attack);
        chain.gainNode.gain.linearRampToValueAtTime(volume * sustain, actx.currentTime + attack + decay);

        if (keyElement) {
            keyElement.classList.add('pressed');
        }

        const voice = {
            sourceNode: sourceNode,
            gainNode: chain.gainNode,
            keyElement: keyElement,
            stopped: false
        };

        sourceNode.onended = function () {
            finalizeNoteCleanup(note, voice);
        };

        state.activeSources[note] = voice;
        captureSeedNoteStart(note);
    }

    function stopSound(note) {
        const voice = state.activeSources[note];
        if (!voice) {
            return;
        }

        const release = Math.max(parseFloat(controls.release.value), 0.03);
        const now = actx.currentTime;

        captureSeedNoteStop(note);

        voice.stopped = true;
        voice.gainNode.gain.cancelScheduledValues(now);
        voice.gainNode.gain.setValueAtTime(voice.gainNode.gain.value, now);
        voice.gainNode.gain.linearRampToValueAtTime(0.0001, now + release);

        try {
            voice.sourceNode.stop(now + release + 0.02);
        } catch (error) {
            finalizeNoteCleanup(note, voice);
            return;
        }

        window.setTimeout(function () {
            finalizeNoteCleanup(note, voice);
        }, Math.round((release + 0.12) * 1000));
    }

    function finalizeNoteCleanup(note, voice) {
        if (state.activeSources[note] !== voice) {
            return;
        }

        if (voice.keyElement) {
            voice.keyElement.classList.remove('pressed');
        }

        delete state.activeSources[note];
    }

    function captureSeedNoteStart(note) {
        if (!state.isRecordingSeed) {
            return;
        }

        state.seed.openNotes[note] = {
            note: note,
            startedAt: actx.currentTime - state.seed.startedAt
        };
    }

    function captureSeedNoteStop(note, forcedEndedAt) {
        if (!state.isRecordingSeed) {
            return;
        }

        const openNote = state.seed.openNotes[note];
        if (!openNote) {
            return;
        }

        const endedAt = typeof forcedEndedAt === 'number'
            ? forcedEndedAt
            : actx.currentTime - state.seed.startedAt;

        state.seed.notes.push({
            note: openNote.note,
            startedAt: openNote.startedAt,
            endedAt: endedAt,
            duration: Math.max(0.04, endedAt - openNote.startedAt)
        });

        delete state.seed.openNotes[note];
    }

    function toggleSeedRecording() {
        if (state.isRecordingSeed) {
            stopSeedRecording();
            return;
        }

        startSeedRecording();
    }

    function startSeedRecording() {
        ensureAudioContext();

        state.seed = createEmptySeed();
        state.seed.startedAt = actx.currentTime;
        state.isRecordingSeed = true;

        controls.recordSeed.textContent = 'Stop Capture';
        controls.recordSeed.classList.add('is-recording');
        controls.seedSummary.textContent = 'Recording now. Aim for 3 to 10 notes with space between gestures.';
        setSeedStatus('Listening for your gesture. Play a short ambient motif.');
    }

    function stopSeedRecording() {
        if (!state.isRecordingSeed) {
            return;
        }

        const stoppedAt = actx.currentTime - state.seed.startedAt;
        Object.keys(state.seed.openNotes).forEach(function (note) {
            captureSeedNoteStop(note, stoppedAt);
        });

        state.seed.stoppedAt = stoppedAt;
        state.seed.analysis = analyzeSeed();
        state.isRecordingSeed = false;

        controls.recordSeed.textContent = 'Record Seed';
        controls.recordSeed.classList.remove('is-recording');

        if (!state.seed.analysis) {
            controls.seedSummary.textContent = 'No notes were captured. Try again with a slower phrase or longer holds.';
            setSeedStatus('No seed found. Default scenes remain active.');
            return;
        }

        const analysis = state.seed.analysis;
        controls.seedSummary.textContent =
            'Seed: ' + analysis.noteCount + ' notes over ' + analysis.duration.toFixed(1) + 's. ' +
            'Center: ' + analysis.rootNote + '. Estimated pulse: ' + analysis.bpm + ' BPM. ' +
            'Energy: ' + Math.round(analysis.energy * 100) + '%.';
        setSeedStatus('Seed captured around ' + analysis.rootNote + '. Generate scenes to reshape the drift bank.');
    }

    function analyzeSeed() {
        const notes = state.seed.notes.slice().sort(function (left, right) {
            return left.startedAt - right.startedAt;
        });

        if (!notes.length) {
            return null;
        }

        const noteCounts = {};
        const pitchClassCounts = {};
        let totalHeld = 0;

        notes.forEach(function (noteEvent) {
            noteCounts[noteEvent.note] = (noteCounts[noteEvent.note] || 0) + 1;
            pitchClassCounts[getPitchClass(noteEvent.note)] = (pitchClassCounts[getPitchClass(noteEvent.note)] || 0) + 1;
            totalHeld += noteEvent.duration;
        });

        const orderedPitchClasses = Object.keys(pitchClassCounts).sort(function (left, right) {
            return pitchClassCounts[right] - pitchClassCounts[left];
        });
        const rootPitchClass = orderedPitchClasses[0] || 'C';
        const preferredRoot = noteOrder.find(function (note) {
            return getPitchClass(note) === rootPitchClass && note.endsWith('4');
        });

        const onsetGaps = [];
        for (let i = 1; i < notes.length; i += 1) {
            onsetGaps.push(notes[i].startedAt - notes[i - 1].startedAt);
        }

        let bpm = 64;
        if (onsetGaps.length) {
            const averageGap = onsetGaps.reduce(function (total, gap) {
                return total + gap;
            }, 0) / onsetGaps.length;
            bpm = Math.round(clamp(60 / Math.max(averageGap, 0.25), 42, 132));
        }

        const uniqueCount = Object.keys(noteCounts).length;
        const duration = Math.max(0.25, notes[notes.length - 1].endedAt);
        const energy = clamp(((notes.length * 0.7) + (uniqueCount * 1.3) + totalHeld) / 18, 0.18, 0.95);
        const spread = clamp(uniqueCount / 7, 0.15, 1);

        return {
            noteCount: notes.length,
            uniqueCount: uniqueCount,
            duration: duration,
            totalHeld: totalHeld,
            bpm: bpm,
            energy: energy,
            spread: spread,
            rootNote: preferredRoot || notes[0].note,
            rootPitchClass: rootPitchClass
        };
    }

    function generateScenes() {
        const analysis = state.seed.analysis;
        const rootNote = analysis ? analysis.rootNote : 'C4';
        const energy = analysis ? analysis.energy : 0.42;
        const spread = analysis ? analysis.spread : 0.34;
        const bpm = analysis ? analysis.bpm : 64;

        state.scenes = [
            {
                id: 'haze',
                name: 'Haze',
                rootNote: rootNote,
                description: 'Glacial fog, filtered air, and a patient harmonic floor.',
                energy: clamp(0.22 + (energy * 0.35), 0.2, 0.62),
                brightness: 0.28 + (spread * 0.18),
                motionBias: 0.02 + (spread * 0.03),
                noiseBias: 0.22,
                shimmer: 0.008,
                intervalRatio: Math.pow(2, 7 / 12),
                detune: -6,
                oscillatorA: 'triangle',
                oscillatorB: 'sine',
                pulse: bpm
            },
            {
                id: 'bloom',
                name: 'Bloom',
                rootNote: transposeNote(rootNote, 5),
                description: 'Soft lift, saturated tails, and widening upper harmonics.',
                energy: clamp(0.38 + (energy * 0.34), 0.34, 0.78),
                brightness: 0.44 + (spread * 0.24),
                motionBias: 0.05 + (spread * 0.04),
                noiseBias: 0.16,
                shimmer: 0.016,
                intervalRatio: 2,
                detune: 10,
                oscillatorA: 'sine',
                oscillatorB: 'triangle',
                pulse: bpm + 4
            },
            {
                id: 'fracture',
                name: 'Fracture',
                rootNote: transposeNote(rootNote, 2),
                description: 'Metallic splinters, unstable stereo drift, and tense overtones.',
                energy: clamp(0.52 + (energy * 0.36), 0.48, 0.92),
                brightness: 0.62 + (spread * 0.16),
                motionBias: 0.1 + (spread * 0.06),
                noiseBias: 0.38,
                shimmer: 0.024,
                intervalRatio: Math.pow(2, 6 / 12),
                detune: 18,
                oscillatorA: 'sawtooth',
                oscillatorB: 'triangle',
                pulse: bpm + 10
            }
        ];

        if (!state.currentSceneId || !state.scenes.some(function (scene) {
            return scene.id === state.currentSceneId;
        })) {
            state.currentSceneId = state.scenes[0].id;
        }

        renderSceneBank();
        updateSceneLabel(false);

        if (analysis) {
            controls.sceneCaption.textContent =
                'Seeded from ' + analysis.rootNote + ' at about ' + analysis.bpm + ' BPM.';
        } else {
            controls.sceneCaption.textContent =
                'Default scene bank loaded. Record a seed to personalize the drift.';
        }

        if (state.activeAmbient) {
            launchScene(state.currentSceneId);
        }
    }

    function renderSceneBank() {
        controls.sceneGrid.innerHTML = '';

        state.scenes.forEach(function (scene) {
            const card = document.createElement('button');
            const meta = document.createElement('div');

            card.type = 'button';
            card.className = 'scene-card' + (scene.id === state.currentSceneId ? ' active' : '');

            const root = document.createElement('span');
            root.className = 'scene-root';
            root.textContent = 'Root ' + scene.rootNote;

            const name = document.createElement('span');
            name.className = 'scene-name';
            name.textContent = scene.name;

            const description = document.createElement('span');
            description.className = 'scene-description';
            description.textContent = scene.description;

            meta.className = 'scene-meta';
            meta.appendChild(makeScenePill('Energy ' + Math.round(scene.energy * 100) + '%'));
            meta.appendChild(makeScenePill('Pulse ' + Math.round(scene.pulse) + ''));

            card.appendChild(root);
            card.appendChild(name);
            card.appendChild(description);
            card.appendChild(meta);

            card.addEventListener('click', function () {
                launchScene(scene.id);
            });

            controls.sceneGrid.appendChild(card);
        });
    }

    function makeScenePill(label) {
        const pill = document.createElement('span');
        pill.className = 'scene-pill';
        pill.textContent = label;
        return pill;
    }

    function getCurrentScene() {
        return state.scenes.find(function (scene) {
            return scene.id === state.currentSceneId;
        }) || null;
    }

    function updateSceneLabel(isRunning) {
        const scene = getCurrentScene();

        if (!scene) {
            controls.activeSceneLabel.textContent = 'Current Scene: Idle';
            return;
        }

        controls.activeSceneLabel.textContent =
            'Current Scene: ' + scene.name + (isRunning ? ' live' : ' armed');
    }

    function startDrift() {
        ensureAudioContext();

        if (!state.scenes.length) {
            generateScenes();
        }

        launchScene(state.currentSceneId || state.scenes[0].id);
    }

    function stopDrift() {
        if (!state.activeAmbient) {
            updateSceneLabel(false);
            setSeedStatus('Drift is idle. Launch a scene when you want the texture bed back.');
            return;
        }

        teardownAmbient(0.8);
        updateSceneLabel(false);
        setSeedStatus('Drift stopped. The keyboard stays live for manual playing.');
    }

    function launchScene(sceneId) {
        const scene = state.scenes.find(function (candidate) {
            return candidate.id === sceneId;
        });

        if (!scene) {
            return;
        }

        ensureAudioContext();

        state.currentSceneId = scene.id;
        renderSceneBank();

        if (state.activeAmbient) {
            teardownAmbient(0.45);
        }

        state.activeAmbient = createAmbientEngine(scene);
        updateSceneLabel(true);
        setSeedStatus(scene.name + ' is active. Move the macro field to evolve the texture.');
    }

    function createAmbientEngine(scene) {
        const macros = getCurrentMacros();
        const now = actx.currentTime;
        const rootFrequency = getFrequency(scene.rootNote);

        const ambient = {
            scene: scene,
            master: actx.createGain(),
            toneFilter: actx.createBiquadFilter(),
            noiseFilter: actx.createBiquadFilter(),
            panner: actx.createStereoPanner(),
            reverb: actx.createConvolver(),
            reverbGain: actx.createGain(),
            delay: actx.createDelay(1.5),
            feedback: actx.createGain(),
            delayGain: actx.createGain(),
            droneA: actx.createOscillator(),
            droneB: actx.createOscillator(),
            shimmer: actx.createOscillator(),
            droneAGain: actx.createGain(),
            droneBGain: actx.createGain(),
            shimmerGain: actx.createGain(),
            lfo: actx.createOscillator(),
            lfoDepth: actx.createGain(),
            panLfo: actx.createOscillator(),
            panDepth: actx.createGain(),
            noiseSource: null,
            noiseGain: actx.createGain()
        };

        ambient.master.gain.value = 0.0001;
        ambient.toneFilter.type = 'lowpass';
        ambient.noiseFilter.type = 'bandpass';
        ambient.noiseFilter.Q.value = 1.2;

        ambient.reverb.buffer = createImpulseResponse(2.6 + (macros.space * 1.4), 2.6);
        ambient.reverbGain.gain.value = 0;
        ambient.delayGain.gain.value = 0;
        ambient.feedback.gain.value = 0.2;

        ambient.droneA.type = scene.oscillatorA;
        ambient.droneB.type = scene.oscillatorB;
        ambient.shimmer.type = 'sine';
        ambient.lfo.type = 'sine';
        ambient.panLfo.type = 'sine';

        ambient.droneA.frequency.value = rootFrequency;
        ambient.droneB.frequency.value = rootFrequency * scene.intervalRatio;
        ambient.shimmer.frequency.value = rootFrequency * 2;
        ambient.lfo.frequency.value = 0.06;
        ambient.panLfo.frequency.value = 0.03;

        ambient.droneA.connect(ambient.droneAGain);
        ambient.droneB.connect(ambient.droneBGain);
        ambient.shimmer.connect(ambient.shimmerGain);

        ambient.droneAGain.connect(ambient.toneFilter);
        ambient.droneBGain.connect(ambient.toneFilter);
        ambient.shimmerGain.connect(ambient.toneFilter);

        if (state.noiseBuffer) {
            ambient.noiseSource = actx.createBufferSource();
            ambient.noiseSource.buffer = state.noiseBuffer;
            ambient.noiseSource.loop = true;
            ambient.noiseSource.playbackRate.value = 0.9;
            ambient.noiseSource.connect(ambient.noiseGain);
            ambient.noiseGain.connect(ambient.noiseFilter);
            ambient.noiseFilter.connect(ambient.toneFilter);
            ambient.noiseSource.start(now);
        }

        ambient.toneFilter.connect(ambient.panner);
        ambient.panner.connect(ambient.master);

        ambient.master.connect(actx.destination);
        ambient.master.connect(ambient.reverb);
        ambient.reverb.connect(ambient.reverbGain);
        ambient.reverbGain.connect(actx.destination);

        ambient.master.connect(ambient.delay);
        ambient.delay.connect(ambient.feedback);
        ambient.feedback.connect(ambient.delay);
        ambient.delay.connect(ambient.delayGain);
        ambient.delayGain.connect(actx.destination);

        ambient.lfo.connect(ambient.lfoDepth);
        ambient.lfoDepth.connect(ambient.toneFilter.frequency);

        ambient.panLfo.connect(ambient.panDepth);
        ambient.panDepth.connect(ambient.panner.pan);

        ambient.droneA.start(now);
        ambient.droneB.start(now);
        ambient.shimmer.start(now);
        ambient.lfo.start(now);
        ambient.panLfo.start(now);

        applyAmbientState(ambient);

        ambient.master.gain.cancelScheduledValues(now);
        ambient.master.gain.setValueAtTime(0.0001, now);
        ambient.master.gain.linearRampToValueAtTime(
            (0.11 + (scene.energy * 0.2) + (macros.density * 0.14)) * parseFloat(controls.volume.value),
            now + 1.3
        );

        return ambient;
    }

    function applyAmbientState(explicitAmbient) {
        const ambient = explicitAmbient && explicitAmbient.scene
            ? explicitAmbient
            : state.activeAmbient;
        if (!ambient) {
            return;
        }

        const scene = ambient.scene;
        const macros = getCurrentMacros();
        const now = actx.currentTime;
        const volume = parseFloat(controls.volume.value);

        ambient.master.gain.cancelScheduledValues(now);
        ambient.master.gain.setTargetAtTime(
            (0.11 + (scene.energy * 0.2) + (macros.density * 0.14)) * volume,
            now,
            0.24
        );

        ambient.droneAGain.gain.setTargetAtTime(
            0.028 + (scene.energy * 0.035) + (macros.density * 0.07),
            now,
            0.18
        );
        ambient.droneBGain.gain.setTargetAtTime(
            0.016 + (scene.energy * 0.024) + (macros.density * 0.045),
            now,
            0.18
        );
        ambient.shimmerGain.gain.setTargetAtTime(
            0.004 + scene.shimmer + (macros.motion * 0.018),
            now,
            0.22
        );

        ambient.toneFilter.frequency.setTargetAtTime(
            360 + (scene.brightness * 1200) + (macros.density * 1100) + (macros.space * 900),
            now,
            0.2
        );
        ambient.toneFilter.Q.setTargetAtTime(
            0.7 + (macros.noise * 1.6),
            now,
            0.2
        );

        ambient.lfo.frequency.setTargetAtTime(
            0.025 + (macros.motion * 0.22) + scene.motionBias,
            now,
            0.2
        );
        ambient.lfoDepth.gain.setTargetAtTime(
            65 + (macros.motion * 230) + (scene.energy * 110),
            now,
            0.2
        );
        ambient.panLfo.frequency.setTargetAtTime(
            0.01 + (macros.motion * 0.12) + (scene.motionBias * 0.3),
            now,
            0.22
        );
        ambient.panDepth.gain.setTargetAtTime(
            0.04 + (macros.space * 0.26),
            now,
            0.22
        );

        ambient.reverbGain.gain.setTargetAtTime(
            0.03 + (macros.space * 0.12) + (controls.reverb.checked ? 0.18 : 0.04),
            now,
            0.24
        );
        ambient.delay.delayTime.setTargetAtTime(
            0.14 + (macros.motion * 0.45),
            now,
            0.2
        );
        ambient.feedback.gain.setTargetAtTime(
            clamp(0.08 + (macros.space * 0.16) + (controls.delay.checked ? 0.14 : 0.04), 0.08, 0.42),
            now,
            0.2
        );
        ambient.delayGain.gain.setTargetAtTime(
            0.015 + (macros.motion * 0.05) + (controls.delay.checked ? 0.12 : 0.02),
            now,
            0.22
        );

        ambient.droneA.detune.setTargetAtTime(scene.detune * macros.motion * 0.25, now, 0.22);
        ambient.droneB.detune.setTargetAtTime(scene.detune * (0.8 + macros.motion), now, 0.22);
        ambient.shimmer.detune.setTargetAtTime(30 + (macros.motion * 45), now, 0.22);

        if (ambient.noiseSource) {
            ambient.noiseGain.gain.setTargetAtTime(
                0.014 + (scene.noiseBias * 0.035) + (macros.noise * 0.14),
                now,
                0.22
            );
            ambient.noiseFilter.frequency.setTargetAtTime(
                240 + (scene.brightness * 800) + (macros.noise * 2500) + (macros.motion * 350),
                now,
                0.2
            );
            ambient.noiseFilter.Q.setTargetAtTime(
                0.8 + (macros.noise * 4),
                now,
                0.2
            );
            ambient.noiseSource.playbackRate.setTargetAtTime(
                0.72 + (macros.motion * 0.5) + (scene.motionBias * 0.8),
                now,
                0.25
            );
        }
    }

    function teardownAmbient(releaseSeconds) {
        const ambient = state.activeAmbient;
        if (!ambient) {
            return;
        }

        const now = actx.currentTime;
        const fadeTime = Math.max(releaseSeconds, 0.2);

        ambient.master.gain.cancelScheduledValues(now);
        ambient.master.gain.setValueAtTime(ambient.master.gain.value, now);
        ambient.master.gain.linearRampToValueAtTime(0.0001, now + fadeTime);

        [
            ambient.droneA,
            ambient.droneB,
            ambient.shimmer,
            ambient.lfo,
            ambient.panLfo,
            ambient.noiseSource
        ].forEach(function (sourceNode) {
            if (!sourceNode) {
                return;
            }

            try {
                sourceNode.stop(now + fadeTime + 0.05);
            } catch (error) {
                return;
            }
        });

        state.activeAmbient = null;

        window.setTimeout(function () {
            Object.keys(ambient).forEach(function (key) {
                const node = ambient[key];
                if (node && typeof node.disconnect === 'function') {
                    try {
                        node.disconnect();
                    } catch (error) {
                        return;
                    }
                }
            });
        }, Math.round((fadeTime + 0.2) * 1000));
    }

    function setSeedStatus(message) {
        controls.seedStatus.textContent = message;
    }
});
