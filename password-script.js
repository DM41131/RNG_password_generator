// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Packs 8 bits into a single byte
 * @param {number[]} bits - Array of bits (0s and 1s)
 * @returns {number} The resulting byte value
 */
function bitsToUint8(bits) {
  let value = 0;
  for (let i = 0; i < bits.length; i++) {
    value = (value << 1) | bits[i];
  }
  return value;
}

/**
 * Converts a buffer to a hexadecimal string
 * @param {Uint8Array} buffer - The buffer to convert
 * @returns {string} Hexadecimal representation
 */
function buf2hex(buffer) {
  return [...buffer].map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generates SHA-256 hash of a string
 * @param {string} str - String to hash
 * @returns {Promise<Uint8Array>} The hash as a Uint8Array
 */
async function sha256String(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hashBuffer);
}

// ============================================================================
// VISUALIZATION MANAGER CLASS (Modified for password generator)
// ============================================================================

class VisualizationManager {
  constructor() {
    this.waveformCanvas = document.getElementById("waveform");
    this.waveCtx = this.waveformCanvas ? this.waveformCanvas.getContext("2d") : null;
    this.histCanvas = document.getElementById("histogram");
    this.histCtx = this.histCanvas ? this.histCanvas.getContext("2d") : null;
  }

  /**
   * Draws histogram of all collected uint8 values
   * @param {number[]} uintArray - Array of uint8 values to visualize
   */
  drawHistogram(uintArray) {
    if (!this.histCanvas || !this.histCtx) return;
    
    const histogram = new Array(256).fill(0);
    uintArray.forEach(v => histogram[v]++);

    this.histCtx.clearRect(0, 0, this.histCanvas.width, this.histCanvas.height);
    const maxCount = Math.max(...histogram);
    if (maxCount === 0) return;

    const barWidth = this.histCanvas.width / 256;
    for (let i = 0; i < 256; i++) {
      const h = (histogram[i] / maxCount) * this.histCanvas.height;
      this.histCtx.fillStyle = "#4caf50";
      this.histCtx.fillRect(i * barWidth, this.histCanvas.height - h, barWidth, h);
    }
  }

  /**
   * Draws the audio waveform
   * @param {Uint8Array} data - Audio data to visualize
   */
  drawWaveform(data) {
    if (!this.waveformCanvas || !this.waveCtx) return;
    
    this.waveCtx.clearRect(0, 0, this.waveformCanvas.width, this.waveformCanvas.height);
    this.waveCtx.beginPath();
    this.waveCtx.strokeStyle = "#0f0";
    this.waveCtx.lineWidth = 2;
    
    for (let x = 0; x < data.length; x++) {
      const y = (data[x] / 255) * this.waveformCanvas.height;
      if (x === 0) {
        this.waveCtx.moveTo(x, y);
      } else {
        this.waveCtx.lineTo((x / data.length) * this.waveformCanvas.width, y);
      }
    }
    this.waveCtx.stroke();
  }
}

// ============================================================================
// PASSWORD GENERATOR CLASS
// ============================================================================

class PasswordGenerator {
  constructor() {
    this.passwordBox = document.getElementById("passwordBox");
    this.pwLengthEl = document.getElementById("pwLength");
    this.chkUpper = document.getElementById("chkUpper");
    this.chkLower = document.getElementById("chkLower");
    this.chkNums = document.getElementById("chkNums");
    this.chkSyms = document.getElementById("chkSyms");
  }

  /**
   * Generates a password using the provided random data
   * @param {number[]} uintArray - Array of random uint8 values
   */
  generatePassword(uintArray) {
    if (uintArray.length < 32) {
      this.passwordBox.value = "Not enough random data yet. Wait for hashing...";
      return;
    }

    let charset = "";
    if (this.chkUpper.checked) charset += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (this.chkLower.checked) charset += "abcdefghijklmnopqrstuvwxyz";
    if (this.chkNums.checked) charset += "0123456789";
    if (this.chkSyms.checked) charset += "!@#$%^&*()-_=+[]{};:,.<>?";

    if (charset.length === 0) {
      this.passwordBox.value = "Please select at least one character set.";
      return;
    }

    const pwLength = Math.max(8, Math.min(64, parseInt(this.pwLengthEl.value) || 16));
    let password = "";
    
    // Use a more random approach to avoid repetition
    let randomIndex = Math.floor(Math.random() * uintArray.length);
    for (let i = 0; i < pwLength; i++) {
      // Use multiple random values to create better entropy
      const r1 = uintArray[randomIndex % uintArray.length];
      const r2 = uintArray[(randomIndex + 1) % uintArray.length];
      const r3 = uintArray[(randomIndex + 2) % uintArray.length];
      
      // Combine multiple random values for better distribution
      const combinedRandom = (r1 + r2 + r3 + i + randomIndex) % charset.length;
      password += charset[combinedRandom];
      
      // Move to next random position with more randomness
      randomIndex = (randomIndex + 1 + (r1 % 13) + (r2 % 7)) % uintArray.length;
    }
    
    this.passwordBox.value = password;
  }
}

// ============================================================================
// AUDIO RNG CLASS (Modified for password generator)
// ============================================================================

class AudioRNG {
  constructor() {
    // DOM elements (optional - may not exist in all pages)
    this.bitsEl = document.getElementById("bits");
    this.uintArrayEl = document.getElementById("uintArray");
    this.hashOutput = document.getElementById("hashOutput");
    this.levelBar = document.getElementById("levelBar");
    this.levelText = document.getElementById("levelText");
    
    // New input control elements (optional)
    this.inputDeviceSelect = document.getElementById("inputDevice");
    this.gainSlider = document.getElementById("gainSlider");
    this.gainValue = document.getElementById("gainValue");
    this.startBtn = document.getElementById("startBtn");
    this.stopBtn = document.getElementById("stopBtn");
    this.refreshDevicesBtn = document.getElementById("refreshDevicesBtn");
    this.waveformInfo = document.getElementById("waveformInfo");
    this.compactLevelBar = document.getElementById("compactLevelBar");
    this.compactLevelText = document.getElementById("compactLevelText");
    
    // Audio context and analyzer
    this.audioCtx = null;
    this.analyser = null;
    this.gainNode = null;
    this.source = null;
    this.stream = null;
    
    // Data buffers
    this.rawBitBuffer = [];
    this.finalBitBuffer = [];
    this.collectedNumbers = [];
    this.uintArray = [];
    
    // Visualization and generators
    this.visualizationManager = new VisualizationManager();
    this.passwordGenerator = new PasswordGenerator();
    this.fileGenerator = null; // Will be set during initialization
    
    // Animation frame ID for cleanup
    this.animationFrameId = null;
    
    // Initialize controls
    this.initializeControls();
  }

  /**
   * Initialize all control event listeners and setup
   */
  initializeControls() {
    // Gain slider (if element exists)
    if (this.gainSlider && this.gainValue) {
      this.gainSlider.addEventListener('input', (e) => {
        this.gainValue.textContent = e.target.value + '%';
        if (this.gainNode) {
          this.gainNode.gain.value = e.target.value / 100;
        }
      });
    }

    // Device selection (if element exists)
    if (this.inputDeviceSelect) {
      this.inputDeviceSelect.addEventListener('change', (e) => {
        if (e.target.value && this.audioCtx) {
          this.restartWithDevice(e.target.value);
        }
      });
    }

    // Refresh devices button (if element exists)
    if (this.refreshDevicesBtn) {
      this.refreshDevicesBtn.addEventListener('click', () => {
        this.loadAudioDevices();
      });
    }

    // Start button (if element exists)
    if (this.startBtn) {
      this.startBtn.addEventListener('click', () => {
        this.start();
      });
    }

    // Stop button (if element exists)
    if (this.stopBtn) {
      this.stopBtn.addEventListener('click', () => {
        this.stop();
      });
    }

    // Load initial devices
    this.loadAudioDevices();
  }

  /**
   * Load available audio input devices
   */
  async loadAudioDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      
      if (this.inputDeviceSelect) {
        this.inputDeviceSelect.innerHTML = '<option value="">Select input device...</option>';
        
        audioInputs.forEach(device => {
          const option = document.createElement('option');
          option.value = device.deviceId;
          option.textContent = device.label || `Microphone ${audioInputs.indexOf(device) + 1}`;
          this.inputDeviceSelect.appendChild(option);
        });
      }
    } catch (error) {
      console.error('Error loading audio devices:', error);
      if (this.waveformInfo) {
        this.waveformInfo.textContent = 'Error loading audio devices';
      }
    }
  }

  /**
   * Restart audio with specific device
   */
  async restartWithDevice(deviceId) {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
    
    try {
      const constraints = {
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      };
      
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.setupAudioContext();
    } catch (error) {
      console.error('Error switching device:', error);
      if (this.waveformInfo) {
        this.waveformInfo.textContent = 'Error switching to selected device';
      }
    }
  }

  /**
   * Setup audio context with gain control
   */
  setupAudioContext() {
    if (this.audioCtx) {
      this.audioCtx.close();
    }
    
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this.source = this.audioCtx.createMediaStreamSource(this.stream);
    
    // Create gain node for level control
    this.gainNode = this.audioCtx.createGain();
    if (this.gainSlider) {
      this.gainNode.gain.value = this.gainSlider.value / 100;
    }
    
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;
    
    // Connect audio nodes
    this.source.connect(this.gainNode);
    this.gainNode.connect(this.analyser);
    
    if (this.waveformInfo) {
      this.waveformInfo.textContent = 'Audio connected - Click Start RNG to begin';
    }
  }

  /**
   * Processes audio samples to extract random bits using Von Neumann method
   * @param {Uint8Array} data - Audio sample data
   */
  async processSamples(data) {
    for (let i = 0; i < data.length; i++) {
      const sample = data[i];
      const bit = sample & 1;
      this.rawBitBuffer.push(bit);

      if (this.rawBitBuffer.length >= 2) {
        const b1 = this.rawBitBuffer.shift();
        const b2 = this.rawBitBuffer.shift();

        // Von Neumann correction: only use 01 and 10 pairs
        if (b1 === 0 && b2 === 1) this.finalBitBuffer.push(0);
        else if (b1 === 1 && b2 === 0) this.finalBitBuffer.push(1);

        // When we have 8 bits, create a byte
        if (this.finalBitBuffer.length === 8) {
          const uint8 = bitsToUint8(this.finalBitBuffer);
          this.collectedNumbers.push(uint8);
          this.finalBitBuffer = [];

          // When we have enough numbers, hash them
          if (this.collectedNumbers.length >= 1000) {
            const asciiString = String.fromCharCode(...this.collectedNumbers.slice(0, 1000));
            const digest = await sha256String(asciiString);

            this.uintArray.push(...digest);
            this.collectedNumbers = [];

            // Update UI (if elements exist)
            if (this.uintArrayEl) {
              this.uintArrayEl.value = this.uintArray.slice(-50).join(", ");
            }
            if (this.hashOutput) {
              this.hashOutput.textContent = "Last SHA-256 Hash (hex): " + buf2hex(digest);
            }

            // Update visualization
            this.visualizationManager.drawHistogram(this.uintArray);

            // Update file generator progress if it's waiting for data
            if (this.fileGenerator && this.fileGenerator.isGenerating) {
              this.fileGenerator.updateProgress(this.uintArray);
            }
          }
        }
      }
    }
    
    // Update bit buffer display (if element exists)
    if (this.bitsEl) {
      this.bitsEl.textContent = 
        "Current unbiased bits (" + this.finalBitBuffer.length + "/8): " + this.finalBitBuffer.join("");
    }
  }

  /**
   * Converts RMS level to logarithmic scale (dB-like)
   * @param {number} rms - RMS level (0-1)
   * @returns {number} Logarithmic level (0-100)
   */
  rmsToLogLevel(rms) {
    if (rms <= 0) return 0;
    
    // Convert to dB scale: 20 * log10(rms)
    // Map -60dB to 0dB range to 0-100%
    const db = 20 * Math.log10(rms);
    const minDb = -60; // Minimum dB level
    const maxDb = 0;   // Maximum dB level
    return Math.max(0, Math.min(100, ((db - minDb) / (maxDb - minDb)) * 100));
  }

  /**
   * Updates the level meter based on audio input
   * @param {Uint8Array} data - Audio sample data
   */
  updateLevelMeter(data) {
    // Calculate RMS (Root Mean Square) for level detection
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const sample = (data[i] - 128) / 128; // Convert to -1 to 1 range
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / data.length);
    
    // Convert to logarithmic scale (dB-like representation)
    const level = this.rmsToLogLevel(rms);
    
    // Update app bar level meter (if elements exist)
    if (this.levelBar) {
      this.levelBar.style.width = level + '%';
    }
    if (this.levelText) {
      this.levelText.textContent = `${Math.round(level)}%`;
    }
    
    // Update compact level meter (if elements exist)
    if (this.compactLevelBar) {
      this.compactLevelBar.style.setProperty('--level', level + '%');
    }
    if (this.compactLevelText) {
      this.compactLevelText.textContent = `${Math.round(level)}%`;
    }
    
    // Use solid green color for level meter
    if (this.levelBar) {
      this.levelBar.style.background = '#4caf50';
    }
  }

  /**
   * Main drawing loop that processes audio and updates visualizations
   */
  drawLoop() {
    this.animationFrameId = requestAnimationFrame(() => this.drawLoop());
    
    if (!this.analyser) return;

    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);

    this.processSamples(data);
    this.updateLevelMeter(data);
    this.visualizationManager.drawWaveform(data);
  }

  /**
   * Starts the audio RNG by requesting microphone access
   */
  async start() {
    try {
      // Get selected device or default
      const deviceId = this.inputDeviceSelect ? this.inputDeviceSelect.value : null;
      const constraints = {
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.setupAudioContext();
      this.drawLoop();
      
      // Update UI (if elements exist)
      if (this.startBtn) {
        this.startBtn.disabled = true;
        this.startBtn.textContent = '🎤 RNG Running...';
      }
      if (this.stopBtn) {
        this.stopBtn.disabled = false;
      }
      if (this.waveformInfo) {
        this.waveformInfo.textContent = 'RNG is running - generating random numbers';
      }
      
      return true;
    } catch (error) {
      console.error("Error starting audio RNG:", error);
      if (this.waveformInfo) {
        this.waveformInfo.textContent = 'Error starting audio capture: ' + error.message;
      }
      return false;
    }
  }

  /**
   * Stops the audio RNG and cleans up resources
   */
  stop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
    
    this.analyser = null;
    this.gainNode = null;
    this.source = null;
    
    // Update UI (if elements exist)
    if (this.startBtn) {
      this.startBtn.disabled = false;
      this.startBtn.textContent = '🎤 Start RNG';
    }
    if (this.stopBtn) {
      this.stopBtn.disabled = true;
    }
    if (this.waveformInfo) {
      this.waveformInfo.textContent = 'RNG stopped - Click Start RNG to begin again';
    }
    
    // Clear level meters (if elements exist)
    if (this.levelBar) {
      this.levelBar.style.width = '0%';
    }
    if (this.levelText) {
      this.levelText.textContent = 'Level: 0%';
    }
    if (this.compactLevelBar) {
      this.compactLevelBar.style.setProperty('--level', '0%');
    }
    if (this.compactLevelText) {
      this.compactLevelText.textContent = '0%';
    }
    
    // Reset file generator state
    if (this.fileGenerator) {
      this.fileGenerator.isGenerating = false;
      this.fileGenerator.requiredDataSize = 0;
      this.fileGenerator.genFileBtn.disabled = false;
      this.fileGenerator.genFileBtn.textContent = "Generate Random File";
      this.fileGenerator.downloadFileBtn.disabled = true;
      this.fileGenerator.fileInfoEl.textContent = "Start RNG to begin collecting random data for file generation.";
      this.fileGenerator.fileInfoEl.className = "file-info";
    }
  }

  /**
   * Gets the current random data array
   * @returns {number[]} Array of random uint8 values
   */
  getRandomData() {
    return this.uintArray;
  }

  /**
   * Reset the random data array
   */
  resetRandomData() {
    this.uintArray = [];
    this.dataCount = 0;
    if (this.dataCountEl) {
      this.dataCountEl.textContent = "0";
    }
  }

}

// ============================================================================
// AUDIO PASSWORD GENERATOR UI CONTROLLER CLASS
// ============================================================================

class AudioPasswordGenerator {
  constructor() {
    this.passwordBox = document.getElementById("passwordBox");
    this.pwLengthEl = document.getElementById("pwLength");
    this.chkUpper = document.getElementById("chkUpper");
    this.chkLower = document.getElementById("chkLower");
    this.chkNums = document.getElementById("chkNums");
    this.chkSyms = document.getElementById("chkSyms");
    this.genPwBtn = document.getElementById("genPwBtn");
    this.statusEl = document.getElementById("status");
    this.startBtn = document.getElementById("startBtn");
    this.stopBtn = document.getElementById("stopBtn");
    this.levelFill = document.getElementById("levelFill");
    this.levelText = document.getElementById("levelText");
    
    // Create a simplified AudioRNG instance
    this.audioRNG = new AudioRNG();
    this.passwordGenerator = this.audioRNG.passwordGenerator;
    
    this.initializeEventListeners();
    this.startDataCountUpdate();
  }

  startDataCountUpdate() {
    // Update status bar and audio level every second
    setInterval(() => {
      const randomData = this.audioRNG.getRandomData();
      
      if (this.audioRNG.stream && randomData.length > 0) {
        this.statusEl.textContent = `Collecting audio data... ${randomData.length} bytes`;
        
        // Update audio level indicator
        this.updateAudioLevel();
      } else {
        // Reset audio level when not running
        this.levelFill.style.width = '0%';
        this.levelText.textContent = '0%';
      }
    }, 1000);
  }

  updateAudioLevel() {
    if (!this.audioRNG.analyser) return;
    
    const data = new Uint8Array(this.audioRNG.analyser.fftSize);
    this.audioRNG.analyser.getByteTimeDomainData(data);
    
    // Calculate RMS (Root Mean Square) for level detection
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const sample = (data[i] - 128) / 128; // Convert to -1 to 1 range
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / data.length);
    
    // Convert to logarithmic scale (dB-like representation)
    const level = this.audioRNG.rmsToLogLevel(rms);
    
    // Update level indicator
    this.levelFill.style.width = level + '%';
    this.levelText.textContent = Math.round(level) + '%';
  }

  validatePasswordLength() {
    const value = parseInt(this.pwLengthEl.value);
    const min = 8;
    const max = 64;
    
    if (isNaN(value) || value < min) {
      this.pwLengthEl.value = min;
      this.statusEl.textContent = `Password length must be at least ${min} characters.`;
      this.pwLengthEl.style.borderColor = '#ff4444';
      setTimeout(() => {
        this.pwLengthEl.style.borderColor = '#555';
      }, 2000);
    } else if (value > max) {
      this.pwLengthEl.value = max;
      this.statusEl.textContent = `Password length cannot exceed ${max} characters.`;
      this.pwLengthEl.style.borderColor = '#ff4444';
      setTimeout(() => {
        this.pwLengthEl.style.borderColor = '#555';
      }, 2000);
    } else {
      this.pwLengthEl.style.borderColor = '#4caf50';
      if (this.statusEl.textContent.includes('Password length')) {
        this.statusEl.textContent = 'Ready to generate secure passwords using audio RNG';
      }
    }
  }

  initializeEventListeners() {
    this.genPwBtn.addEventListener('click', () => {
      this.generatePassword();
    });

    this.startBtn.addEventListener('click', () => {
      this.startAudioRNG();
    });

    this.stopBtn.addEventListener('click', () => {
      this.stopAudioRNG();
    });

    // Password length validation - only on blur to allow typing
    this.pwLengthEl.addEventListener('blur', (e) => {
      this.validatePasswordLength();
    });

    // Prevent non-numeric input
    this.pwLengthEl.addEventListener('keydown', (e) => {
      // Allow: backspace, delete, tab, escape, enter, home, end, left, right, up, down
      if ([8, 9, 27, 13, 46, 35, 36, 37, 38, 39, 40].indexOf(e.keyCode) !== -1 ||
          // Allow: Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X
          (e.keyCode === 65 && e.ctrlKey === true) ||
          (e.keyCode === 67 && e.ctrlKey === true) ||
          (e.keyCode === 86 && e.ctrlKey === true) ||
          (e.keyCode === 88 && e.ctrlKey === true)) {
        return;
      }
      // Ensure that it is a number and stop the keypress
      if ((e.shiftKey || (e.keyCode < 48 || e.keyCode > 57)) && (e.keyCode < 96 || e.keyCode > 105)) {
        e.preventDefault();
      }
    });

    // Allow Enter key to generate password
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.generatePassword();
      }
    });
  }

  async startAudioRNG() {
    try {
      await this.audioRNG.start();
      this.startBtn.disabled = true;
      this.startBtn.textContent = '🎤 Running...';
      this.stopBtn.disabled = false;
      this.statusEl.textContent = 'Audio RNG started! Collecting random data...';
    } catch (error) {
      this.statusEl.textContent = 'Failed to start audio RNG: ' + error.message;
    }
  }

  stopAudioRNG() {
    this.audioRNG.stop();
    this.startBtn.disabled = false;
    this.startBtn.textContent = '🎤 Start RNG';
    this.stopBtn.disabled = true;
    this.statusEl.textContent = 'Audio RNG stopped - click Start RNG to begin';
    
    // Reset audio level indicator
    this.levelFill.style.width = '0%';
    this.levelText.textContent = '0%';
  }

  generatePassword() {
    // Validate character sets
    let charset = "";
    if (this.chkUpper.checked) charset += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (this.chkLower.checked) charset += "abcdefghijklmnopqrstuvwxyz";
    if (this.chkNums.checked) charset += "0123456789";
    if (this.chkSyms.checked) charset += "!@#$%^&*()-_=+[]{};:,.<>?";

    if (charset.length === 0) {
      this.statusEl.textContent = "Please select at least one character set.";
      return;
    }

    const randomData = this.audioRNG.getRandomData();
    if (randomData.length < 32) {
      this.statusEl.textContent = "Not enough random data. Please start the audio RNG and wait for data collection.";
      return;
    }

    // Get password length (validation already handled on blur)
    const pwLength = parseInt(this.pwLengthEl.value) || 16;
    
    // Check if we have enough data to avoid repetition (reduced requirement)
    if (randomData.length < Math.max(32, pwLength)) {
      this.statusEl.textContent = `Need more random data. Have ${randomData.length} bytes, need at least ${Math.max(32, pwLength)} bytes for secure generation.`;
      return;
    }

    this.passwordGenerator.generatePassword(randomData);
    this.passwordBox.select();
    
    // Reset the random data array after generation for fresh next generation
    this.audioRNG.resetRandomData();
  }


}

// ============================================================================
// APPLICATION INITIALIZATION
// ============================================================================

// Initialize the password generator when the page loads
document.addEventListener('DOMContentLoaded', () => {
  new AudioPasswordGenerator();
});
