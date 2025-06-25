document.addEventListener('DOMContentLoaded', function () {
    const actx = new (window.AudioContext || window.webkitAudioContext)();
    const keys = document.querySelectorAll('#piano-keyboard .white-key, #piano-keyboard .black-key');
    const activeSources = {}; // Changed from activeOscillators to activeSources to be more general
    const volumeControl = document.getElementById('volume');
    const reverbControl = document.getElementById('reverb');
    const delayControl = document.getElementById('delay');
    const attackControl = document.getElementById('attack');
    const decayControl = document.getElementById('decay');
    const sustainControl = document.getElementById('sustain');
    const releaseControl = document.getElementById('release');
    const instrumentSelect = document.getElementById('instrument-select'); // New: Instrument select

    let volumeValue = volumeControl.value;
    let attackValue = attackControl.value;
    let decayValue = decayControl.value;
    let sustainValue = sustainControl.value;
    let releaseValue = releaseControl.value;
    let currentInstrument = instrumentSelect.value; // New: Current selected instrument

    let loopSource = null;
    let loopBuffer = null;

    // New: Object to store loaded audio buffers for samples
    const audioBuffers = {};
    // New: Base URL for your samples (adjust this to where your sample files are)
    const samplesBaseUrl = 'samples/'; 

    // New: Mapping of instrument names to sample files
    const instrumentSamples = {
        'piano': 'piano.wav',
        'guitar': 'guitar.wav',
        // Add more instruments and their corresponding sample files here
        // 'guitar': 'guitar.wav',
    };

    volumeControl.addEventListener('input', (e) => volumeValue = e.target.value);
    attackControl.addEventListener('input', (e) => attackValue = e.target.value);
    decayControl.addEventListener('input', (e) => decayValue = e.target.value);
    sustainControl.addEventListener('input', (e) => sustainValue = e.target.value);
    releaseControl.addEventListener('input', (e) => releaseValue = e.target.value);
    // New: Event listener for instrument selection
    instrumentSelect.addEventListener('change', (e) => currentInstrument = e.target.value);


    // --- Sample Loading Functions ---
    async function loadAudioSample(instrumentName, url) {
        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await actx.decodeAudioData(arrayBuffer);
            audioBuffers[instrumentName] = audioBuffer;
            console.log(`Sample "${instrumentName}" loaded successfully.`);
        } catch (error) {
            console.error(`Error loading sample "${instrumentName}" from ${url}:`, error);
        }
    }

    // New: Function to load all instrument samples on startup
    async function loadAllSamples() {
        const samplePromises = [];
        for (const instrument in instrumentSamples) {
            const url = samplesBaseUrl + instrumentSamples[instrument];
            samplePromises.push(loadAudioSample(instrument, url));
        }
        await Promise.all(samplePromises);
        console.log('All instrument samples loaded.');
    }

    // --- Existing Loop Functions (no changes needed here) ---
    function loadLoop(url) {
        fetch(url)
            .then(response => response.arrayBuffer())
            .then(data => actx.decodeAudioData(data))
            .then(buffer => {
                loopBuffer = buffer;
            })
            .catch(error => console.error('Error loading the audio loop:', error));
    }

    function playLoop() {
        if (loopBuffer) {
            loopSource = actx.createBufferSource();
            loopSource.buffer = loopBuffer;
            loopSource.loop = true;
            loopSource.connect(actx.destination);
            loopSource.start(actx.currentTime);
        }
    }

    function stopLoop() {
        if (loopSource) {
            loopSource.stop();
            loopSource = null;
        }
    }

    loadLoop('groove.mp3');

    const playButton = document.getElementById('play-loop');
    const stopButton = document.getElementById('stop-loop');

    playButton.addEventListener('click', playLoop);
    stopButton.addEventListener('click', stopLoop);

    // --- Frequency mapping (only used for sine wave now, but good to keep) ---
    function getFrequency(note) {
        const notes = {
            'C4': 261.63, 'C#4': 277.18, 'D4': 293.66, 'D#4': 311.13, 'E4': 329.63,
            'F4': 349.23, 'F#4': 369.99, 'G4': 392.00, 'G#4': 415.30, 'A4': 440.00,
            'A#4': 466.16, 'B4': 493.88, 'C5': 523.25, 'C#5': 554.37, 'D5': 587.33,
            'D#5': 622.25, 'E5': 659.25, 'F5': 698.46, 'F#5': 739.99, 'G5': 783.99,
            'G#5': 830.61, 'A5': 880.00, 'A#5': 932.33, 'B5': 987.77, 'C6': 1046.50
        };
        return notes[note];
    }

    // New: Function to calculate playback rate for pitch shifting
    function calculatePlaybackRate(targetNote, fundamentalNote = 'C4') {
        const fundamentalFreq = getFrequency(fundamentalNote);
        const targetFreq = getFrequency(targetNote);
        if (!fundamentalFreq || !targetFreq) {
            console.warn(`Could not find frequency for note ${targetNote} or fundamental note ${fundamentalNote}.`);
            return 1; // Default to normal playback
        }
        return targetFreq / fundamentalFreq;
    }


    // --- Modified startSound function ---
    function startSound(note) {
        // If the note is already playing, stop it first to prevent multiple instances
        if (activeSources[note]) {
            stopSound(note);
        }

        const gainNode = actx.createGain();
        const panNode = actx.createStereoPanner();
        const delayNode = actx.createDelay();
        const feedbackNode = actx.createGain();
        const filterNode = actx.createBiquadFilter();
        const convolverNode = actx.createConvolver();

        let sourceNode;

        if (currentInstrument === 'sine') {
            sourceNode = actx.createOscillator();
            sourceNode.type = 'sine';
            sourceNode.frequency.value = getFrequency(note);
            sourceNode.start();
        } else {
            // New: Play a sample
            const sampleBuffer = audioBuffers[currentInstrument];
            if (!sampleBuffer) {
                console.warn(`Sample for instrument "${currentInstrument}" not loaded. Falling back to sine wave.`);
                sourceNode = actx.createOscillator();
                sourceNode.type = 'sine';
                sourceNode.frequency.value = getFrequency(note);
                sourceNode.start();
            } else {
                sourceNode = actx.createBufferSource();
                sourceNode.buffer = sampleBuffer;
                // New: Adjust playback rate for pitch shifting
                // Assuming 'piano.wav' is a C4 note for accurate pitch shifting. Adjust 'C4' if your sample is a different fundamental.
                sourceNode.playbackRate.value = calculatePlaybackRate(note, 'C4'); 
                sourceNode.start(0); // Start immediately
            }
        }

        gainNode.gain.setValueAtTime(0, actx.currentTime);
        gainNode.gain.linearRampToValueAtTime(volumeValue, actx.currentTime + parseFloat(attackValue));
        gainNode.gain.linearRampToValueAtTime(volumeValue * sustainValue, actx.currentTime + parseFloat(attackValue) + parseFloat(decayValue));

        sourceNode.connect(gainNode);
        gainNode.connect(panNode);

        // --- Effects Chain (mostly unchanged) ---
        let lastNodeInChain = panNode;

        if (delayControl.checked) {
            delayNode.delayTime.value = 0.3;
            feedbackNode.gain.value = 0.3;
            filterNode.frequency.value = 1000;

            // Connect in a feedback loop for delay
            lastNodeInChain.connect(delayNode);
            delayNode.connect(feedbackNode);
            feedbackNode.connect(filterNode);
            filterNode.connect(delayNode);
            
            // Connect delay to the destination (or to convolver if reverb is on)
            lastNodeInChain = delayNode; // Delay is now the last node
        }

        if (reverbControl.checked) {
            convolverNode.buffer = impulseResponse(2, 2, false, actx);
            lastNodeInChain.connect(convolverNode);
            convolverNode.connect(actx.destination); // Convolver goes directly to destination
        } else {
            lastNodeInChain.connect(actx.destination); // If no reverb, connect the previous last node to destination
        }


        // Store the sourceNode and gainNode in activeSources
        activeSources[note] = { sourceNode, gainNode };

        document.querySelector(`[data-note="${note}"]`).classList.add('pressed');
    }


    // --- Modified stopSound function ---
    function stopSound(note) {
        if (activeSources[note]) {
            const { sourceNode, gainNode } = activeSources[note];
            gainNode.gain.cancelScheduledValues(actx.currentTime);
            gainNode.gain.setValueAtTime(gainNode.gain.value, actx.currentTime);
            gainNode.gain.linearRampToValueAtTime(0, actx.currentTime + parseFloat(releaseValue));
            // Stop the sourceNode after the release phase
            sourceNode.stop(actx.currentTime + parseFloat(releaseValue)); 
            delete activeSources[note];

            document.querySelector(`[data-note="${note}"]`).classList.remove('pressed');
        }
    }


    const keyMap = {
        'A': 'C4', 'W': 'C#4', 'S': 'D4', 'E': 'D#4', 'D': 'E4',
        'F': 'F4', 'T': 'F#4', 'G': 'G4', 'Y': 'G#4', 'H': 'A4',
        'U': 'A#4', 'J': 'B4', 'K': 'C5', 'O': 'C#5', 'L': 'D5',
        'P': 'D#5', ';': 'E5', '\'': 'F5', ']': 'F#5', '\\': 'G5',
        '[': 'G#5', 'Z': 'A5', 'X': 'A#5', 'C': 'B5', 'V': 'C6'
    };

    keys.forEach(key => {
        const note = key.getAttribute('data-note');

        key.addEventListener('mousedown', () => startSound(note));
        key.addEventListener('mouseup', () => stopSound(note));
        // For touch devices, ensure touchend is triggered for proper release
        key.addEventListener('touchstart', (e) => { e.preventDefault(); startSound(note); }, { passive: false });
        key.addEventListener('touchend', (e) => { e.preventDefault(); stopSound(note); }, { passive: false });
    });

    document.addEventListener('keydown', (e) => {
        const note = keyMap[e.key.toUpperCase()];
        // Check if the key is already pressed to avoid re-triggering on hold
        if (note && !activeSources[note]) { 
            startSound(note);
        }
    });

    document.addEventListener('keyup', (e) => {
        const note = keyMap[e.key.toUpperCase()];
        if (note) {
            stopSound(note);
        }
    });

    // --- Impulse Response Function (for reverb) ---
    // This function creates a simple impulse response for the convolver node.
    // You might want to load actual impulse response files for better reverb.
    function impulseResponse(duration, decay, reverse, actx) {
        var sampleRate = actx.sampleRate;
        var length = sampleRate * duration;
        var impulse = actx.createBuffer(2, length, sampleRate);
        var impulseL = impulse.getChannelData(0);
        var impulseR = impulse.getChannelData(1);
        var n;
        for (n = 0; n < length; n++) {
            var x = reverse ? length - n : n;
            impulseL[n] = (Math.random() * 2 - 1) * Math.pow(1 - x / length, decay);
            impulseR[n] = (Math.random() * 2 - 1) * Math.pow(1 - x / length, decay);
        }
        return impulse;
    }

    // Call this to load samples when the page loads
    loadAllSamples();
});
