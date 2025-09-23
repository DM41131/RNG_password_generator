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
// VISUALIZATION MANAGER CLASS
// ============================================================================

class VisualizationManager {
  constructor() {
    this.waveformCanvas = document.getElementById("waveform");
    this.waveCtx = this.waveformCanvas.getContext("2d");
    this.histCanvas = document.getElementById("histogram");
    this.histCtx = this.histCanvas.getContext("2d");
    this.bitMatrixCanvas = document.getElementById("bitMatrix");
    this.bitMatrixCtx = this.bitMatrixCanvas.getContext("2d");
    
    // Bit matrix optimization properties
    this.matrixWidth = 200;
    this.matrixHeight = 100;
    this.pixelSize = 2;
    this.canvasWidth = this.matrixWidth * this.pixelSize;
    this.canvasHeight = this.matrixHeight * this.pixelSize;
    this.bitMatrixData = new Array(this.matrixWidth * this.matrixHeight).fill(0);
    this.lastBitCount = 0;
    this.updateThrottle = 0;
    this.updateInterval = 50; // Reduced to 50ms for better responsiveness
    this.showGrid = false; // Disable grid by default for better performance
    this.refreshCycle = 0; // Track refresh cycles
    this.isMatrixComplete = false; // Track if matrix is fully loaded
    
    // Performance optimization properties
    this.imageData = null; // For direct pixel manipulation
    this.pendingUpdates = []; // Batch updates for better performance
    this.animationFrameId = null; // Track animation frame
    this.performanceMetrics = {
      lastUpdateTime: 0,
      updateCount: 0,
      averageUpdateTime: 0
    };
    this.adaptiveInterval = true; // Enable adaptive update frequency
    
    // Set initial canvas size based on matrix dimensions
    this.updateCanvasSize();
  }

  /**
   * Update canvas size to match matrix dimensions
   */
  updateCanvasSize() {
    if (this.bitMatrixCanvas) {
      this.bitMatrixCanvas.width = this.canvasWidth;
      this.bitMatrixCanvas.height = this.canvasHeight;
    }
  }

  /**
   * Draws histogram of all collected uint8 values
   * @param {number[]} uintArray - Array of uint8 values to visualize
   */
  drawHistogram(uintArray) {
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

  /**
   * Optimized bit conversion using bitwise operations and pre-allocated array
   * @param {number[]} uintArray - Array of uint8 values
   * @returns {number[]} Array of bits (0s and 1s)
   */
  uint8ArrayToBits(uintArray) {
    const totalBits = uintArray.length * 8;
    const bits = new Array(totalBits);
    
    for (let i = 0; i < uintArray.length; i++) {
      const byte = uintArray[i];
      const baseIndex = i * 8;
      
      // Unroll the bit extraction loop for better performance
      bits[baseIndex] = (byte >> 7) & 1;
      bits[baseIndex + 1] = (byte >> 6) & 1;
      bits[baseIndex + 2] = (byte >> 5) & 1;
      bits[baseIndex + 3] = (byte >> 4) & 1;
      bits[baseIndex + 4] = (byte >> 3) & 1;
      bits[baseIndex + 5] = (byte >> 2) & 1;
      bits[baseIndex + 6] = (byte >> 1) & 1;
      bits[baseIndex + 7] = byte & 1;
    }
    
    return bits;
  }

  /**
   * High-performance Bit Matrix Plot with ImageData optimization
   * @param {number[]} uintArray - Array of uint8 values to visualize as bits
   */
  drawBitMatrix(uintArray) {
    if (!this.bitMatrixCanvas || !this.bitMatrixCtx) return;
    
    const startTime = performance.now();
    
    // Adaptive throttling based on performance
    const now = Date.now();
    if (this.adaptiveInterval && now - this.updateThrottle < this.updateInterval) {
      return;
    }
    this.updateThrottle = now;
    
    // Convert uint8 array to bits
    const bits = this.uint8ArrayToBits(uintArray);
    const currentBitCount = bits.length;
    const maxMatrixBits = this.matrixWidth * this.matrixHeight;
    
    // Calculate canvas offsets
    const offsetX = (this.bitMatrixCanvas.width - this.canvasWidth) / 2;
    const offsetY = (this.bitMatrixCanvas.height - this.canvasHeight) / 2;
    
    // Initialize ImageData for direct pixel manipulation
    if (!this.imageData) {
      this.imageData = this.bitMatrixCtx.createImageData(this.canvasWidth, this.canvasHeight);
      this.initializeImageData();
    }
    
    // Check if matrix is complete and needs full refresh
    if (this.lastBitCount >= maxMatrixBits && currentBitCount > maxMatrixBits) {
      this.performFullRefresh(offsetX, offsetY);
      return;
    }
    
    // Initialize canvas only once
    if (this.lastBitCount === 0 && !this.isMatrixComplete) {
      this.initializeCanvas(offsetX, offsetY);
    }
    
    // Only update if we have new bits and matrix is not complete
    if (currentBitCount <= this.lastBitCount || this.isMatrixComplete) return;
    
    // Calculate how many new bits to process (adaptive chunk size)
    const chunkSize = this.calculateOptimalChunkSize();
    const newBitsCount = Math.min(currentBitCount - this.lastBitCount, chunkSize);
    const startBitIndex = this.lastBitCount;
    const endBitIndex = Math.min(startBitIndex + newBitsCount, maxMatrixBits);
    
    // Batch update pixels using ImageData
    this.updatePixelsBatch(bits, startBitIndex, endBitIndex, offsetX, offsetY);
    
    // Update last bit count
    this.lastBitCount = Math.min(endBitIndex, currentBitCount);
    
    // Check if matrix is now complete
    if (this.lastBitCount >= maxMatrixBits) {
      this.isMatrixComplete = true;
      this.addCompletionIndicator(offsetX, offsetY);
    }
    
    // Update performance metrics
    this.updatePerformanceMetrics(startTime);
  }

  /**
   * Initialize ImageData with white background
   */
  initializeImageData() {
    const data = this.imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255;     // R
      data[i + 1] = 255; // G
      data[i + 2] = 255; // B
      data[i + 3] = 255; // A
    }
  }

  /**
   * Initialize canvas with background and border
   */
  initializeCanvas(offsetX, offsetY) {
    this.bitMatrixCtx.clearRect(0, 0, this.bitMatrixCanvas.width, this.bitMatrixCanvas.height);
    
    // Draw background (white)
    this.bitMatrixCtx.fillStyle = "#ffffff";
    this.bitMatrixCtx.fillRect(offsetX, offsetY, this.canvasWidth, this.canvasHeight);
    
    // Draw border
    this.bitMatrixCtx.strokeStyle = "#000000";
    this.bitMatrixCtx.lineWidth = 1;
    this.bitMatrixCtx.strokeRect(offsetX, offsetY, this.canvasWidth, this.canvasHeight);
  }

  /**
   * Perform full refresh with optimized clearing
   */
  performFullRefresh(offsetX, offsetY) {
    this.refreshCycle++;
    this.isMatrixComplete = false;
    this.lastBitCount = 0;
    
    // Clear canvas
    this.bitMatrixCtx.clearRect(0, 0, this.bitMatrixCanvas.width, this.bitMatrixCanvas.height);
    
    // Reset ImageData
    this.initializeImageData();
    
    // Draw background and border
    this.initializeCanvas(offsetX, offsetY);
    
    // Reset matrix data
    this.bitMatrixData.fill(0);
    
    // Add refresh indicator
    this.bitMatrixCtx.fillStyle = "#ff6b6b";
    this.bitMatrixCtx.font = "12px Arial";
    this.bitMatrixCtx.fillText(`Refresh #${this.refreshCycle}`, offsetX + 5, offsetY + 15);
  }

  /**
   * Calculate optimal chunk size based on performance
   */
  calculateOptimalChunkSize() {
    const baseChunkSize = 2000;
    if (!this.adaptiveInterval) return baseChunkSize;
    
    // Adjust chunk size based on average update time
    if (this.performanceMetrics.averageUpdateTime > 16) { // > 16ms
      return Math.max(500, baseChunkSize * 0.5);
    } else if (this.performanceMetrics.averageUpdateTime < 8) { // < 8ms
      return Math.min(5000, baseChunkSize * 1.5);
    }
    return baseChunkSize;
  }

  /**
   * Batch update pixels using ImageData for better performance
   */
  updatePixelsBatch(bits, startBitIndex, endBitIndex, offsetX, offsetY) {
    const data = this.imageData.data;
    let hasChanges = false;
    
    for (let bitIndex = startBitIndex; bitIndex < endBitIndex; bitIndex++) {
      const row = Math.floor(bitIndex / this.matrixWidth);
      const col = bitIndex % this.matrixWidth;
      
      const bitValue = bitIndex < bits.length ? bits[bitIndex] : 0;
      const dataIndex = row * this.matrixWidth + col;
      
      // Only update if the bit value changed
      if (this.bitMatrixData[dataIndex] !== bitValue) {
        this.bitMatrixData[dataIndex] = bitValue;
        hasChanges = true;
        
        // Update ImageData for 2x2 pixel square
        const pixelValue = bitValue === 1 ? 0 : 255;
        const imageX = col * this.pixelSize;
        const imageY = row * this.pixelSize;
        
        for (let py = 0; py < this.pixelSize; py++) {
          for (let px = 0; px < this.pixelSize; px++) {
            const pixelIndex = ((imageY + py) * this.canvasWidth + (imageX + px)) * 4;
            if (pixelIndex < data.length) {
              data[pixelIndex] = pixelValue;     // R
              data[pixelIndex + 1] = pixelValue; // G
              data[pixelIndex + 2] = pixelValue; // B
              data[pixelIndex + 3] = 255;        // A
            }
          }
        }
      }
    }
    
    // Only putImageData if there were changes
    if (hasChanges) {
      this.bitMatrixCtx.putImageData(this.imageData, offsetX, offsetY);
    }
  }

  /**
   * Add completion indicator
   */
  addCompletionIndicator(offsetX, offsetY) {
    this.bitMatrixCtx.fillStyle = "#4caf50";
    this.bitMatrixCtx.font = "12px Arial";
    this.bitMatrixCtx.fillText("Complete!", offsetX + this.canvasWidth - 60, offsetY + 15);
  }

  /**
   * Update performance metrics for adaptive optimization
   */
  updatePerformanceMetrics(startTime) {
    const updateTime = performance.now() - startTime;
    this.performanceMetrics.updateCount++;
    this.performanceMetrics.averageUpdateTime = 
      (this.performanceMetrics.averageUpdateTime * (this.performanceMetrics.updateCount - 1) + updateTime) / 
      this.performanceMetrics.updateCount;
    
    // Adjust update interval based on performance
    if (this.adaptiveInterval) {
      if (this.performanceMetrics.averageUpdateTime > 20) {
        this.updateInterval = Math.min(200, this.updateInterval + 10);
      } else if (this.performanceMetrics.averageUpdateTime < 5) {
        this.updateInterval = Math.max(30, this.updateInterval - 5);
      }
    }
  }

  /**
   * Draw grid lines for the bit matrix (only when needed)
   */
  drawGridLines(offsetX, offsetY) {
    this.bitMatrixCtx.strokeStyle = "#cccccc";
    this.bitMatrixCtx.lineWidth = 0.5;
    
    // Vertical grid lines
    for (let i = 0; i <= this.matrixWidth; i += 10) {
      const x = offsetX + i * this.pixelSize;
      this.bitMatrixCtx.beginPath();
      this.bitMatrixCtx.moveTo(x, offsetY);
      this.bitMatrixCtx.lineTo(x, offsetY + this.canvasHeight);
      this.bitMatrixCtx.stroke();
    }
    
    // Horizontal grid lines
    for (let i = 0; i <= this.matrixHeight; i += 10) {
      const y = offsetY + i * this.pixelSize;
      this.bitMatrixCtx.beginPath();
      this.bitMatrixCtx.moveTo(offsetX, y);
      this.bitMatrixCtx.lineTo(offsetX + this.canvasWidth, y);
      this.bitMatrixCtx.stroke();
    }
  }

  /**
   * Reset the bit matrix (call when starting new generation)
   */
  resetBitMatrix() {
    // Update canvas size to match current matrix dimensions
    this.updateCanvasSize();
    
    // Reset matrix data with current dimensions
    this.bitMatrixData = new Array(this.matrixWidth * this.matrixHeight).fill(0);
    this.lastBitCount = 0;
    this.isMatrixComplete = false;
    this.refreshCycle = 0;
    this.imageData = null; // Reset ImageData
    this.performanceMetrics = {
      lastUpdateTime: 0,
      updateCount: 0,
      averageUpdateTime: 0
    };
    this.updateInterval = 50; // Reset to default interval
    if (this.bitMatrixCanvas && this.bitMatrixCtx) {
      this.bitMatrixCtx.clearRect(0, 0, this.bitMatrixCanvas.width, this.bitMatrixCanvas.height);
    }
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
    
    for (let i = 0; i < pwLength; i++) {
      const r = uintArray[(i + uintArray.length - pwLength) % uintArray.length];
      password += charset[r % charset.length];
    }
    
    this.passwordBox.value = password;
  }
}

// ============================================================================
// AUDIO RNG CLASS
// ============================================================================

class AudioRNG {
  constructor() {
    // DOM elements
    this.bitsEl = document.getElementById("bits");
    this.uintArrayEl = document.getElementById("uintArray");
    this.hashOutput = document.getElementById("hashOutput");
    this.levelBar = document.getElementById("levelBar");
    this.levelText = document.getElementById("levelText");
    
    // New input control elements
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
    // Gain slider
    this.gainSlider.addEventListener('input', (e) => {
      this.gainValue.textContent = e.target.value + '%';
      if (this.gainNode) {
        this.gainNode.gain.value = e.target.value / 100;
      }
    });

    // Device selection
    this.inputDeviceSelect.addEventListener('change', (e) => {
      if (e.target.value && this.audioCtx) {
        this.restartWithDevice(e.target.value);
      }
    });

    // Refresh devices button
    this.refreshDevicesBtn.addEventListener('click', () => {
      this.loadAudioDevices();
    });

    // Start button
    this.startBtn.addEventListener('click', () => {
      this.start();
    });

    // Stop button
    this.stopBtn.addEventListener('click', () => {
      this.stop();
    });

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
      
      this.inputDeviceSelect.innerHTML = '<option value="">Select input device...</option>';
      
      audioInputs.forEach(device => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Microphone ${audioInputs.indexOf(device) + 1}`;
        this.inputDeviceSelect.appendChild(option);
      });
    } catch (error) {
      console.error('Error loading audio devices:', error);
      this.waveformInfo.textContent = 'Error loading audio devices';
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
      this.waveformInfo.textContent = 'Error switching to selected device';
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
    this.gainNode.gain.value = this.gainSlider.value / 100;
    
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;
    
    // Connect audio nodes
    this.source.connect(this.gainNode);
    this.gainNode.connect(this.analyser);
    
    this.waveformInfo.textContent = 'Audio connected - Click Start RNG to begin';
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

            // Update UI
            this.uintArrayEl.value = this.uintArray.slice(-50).join(", ");
            this.hashOutput.textContent = "Last SHA-256 Hash (hex): " + buf2hex(digest);

            // Update visualization
            this.visualizationManager.drawHistogram(this.uintArray);
            this.visualizationManager.drawBitMatrix(this.uintArray);

            // Update file generator progress if it's waiting for data
            if (this.fileGenerator && this.fileGenerator.isGenerating) {
              this.fileGenerator.updateProgress(this.uintArray);
            }
          }
        }
      }
    }
    
    // Update bit buffer display
    this.bitsEl.textContent = 
      "Current unbiased bits (" + this.finalBitBuffer.length + "/8): " + this.finalBitBuffer.join("");
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
    const level = Math.min(100, Math.max(0, rms * 100));
    
    // Update app bar level meter
    this.levelBar.style.width = level + '%';
    this.levelText.textContent = `Level: ${Math.round(level)}%`;
    
    // Update compact level meter
    this.compactLevelBar.style.setProperty('--level', level + '%');
    this.compactLevelText.textContent = `${Math.round(level)}%`;
    
    // Change color based on level
    const colorGradient = level < 30 
      ? 'linear-gradient(90deg, #4caf50 0%, #4caf50 100%)'
      : level < 70 
      ? 'linear-gradient(90deg, #4caf50 0%, #ffeb3b 100%)'
      : 'linear-gradient(90deg, #4caf50 0%, #ffeb3b 50%, #f44336 100%)';
    
    this.levelBar.style.background = colorGradient;
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
      const deviceId = this.inputDeviceSelect.value;
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
      
      // Reset bit matrix for new generation
      this.visualizationManager.resetBitMatrix();
      
      this.drawLoop();
      
      // Update UI
      this.startBtn.disabled = true;
      this.startBtn.textContent = '🎤 RNG Running...';
      this.stopBtn.disabled = false;
      this.waveformInfo.textContent = 'RNG is running - generating random numbers';
      
      return true;
    } catch (error) {
      console.error("Error starting audio RNG:", error);
      this.waveformInfo.textContent = 'Error starting audio capture: ' + error.message;
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
    
    // Update UI
    this.startBtn.disabled = false;
    this.startBtn.textContent = '🎤 Start RNG';
    this.stopBtn.disabled = true;
    this.waveformInfo.textContent = 'RNG stopped - Click Start RNG to begin again';
    
    // Clear level meters
    this.levelBar.style.width = '0%';
    this.levelText.textContent = 'Level: 0%';
    this.compactLevelBar.style.setProperty('--level', '0%');
    this.compactLevelText.textContent = '0%';
    
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
}

// ============================================================================
// FILE GENERATOR CLASS
// ============================================================================

class FileGenerator {
  constructor() {
    this.fileSizeEl = document.getElementById("fileSize");
    this.fileNameEl = document.getElementById("fileName");
    this.genFileBtn = document.getElementById("genFileBtn");
    this.downloadFileBtn = document.getElementById("downloadFileBtn");
    this.fileInfoEl = document.getElementById("fileInfo");
    this.generatedFile = null;
    this.isGenerating = false;
    this.requiredDataSize = 0;
    
    // Set initial message
    this.fileInfoEl.textContent = "Start RNG to begin collecting random data for file generation.";
    this.fileInfoEl.className = "file-info";
  }

  /**
   * Generates a random file using the provided random data
   * @param {number[]} uintArray - Array of random uint8 values
   */
  generateFile(uintArray) {
    const fileSize = Math.max(1, Math.min(10485760, parseInt(this.fileSizeEl.value) || 1024));
    const fileName = this.fileNameEl.value || "random_data.bin";
    
    // Check if we have enough data for the requested file size
    if (uintArray.length < fileSize) {
      this.requiredDataSize = fileSize;
      this.isGenerating = true;
      this.genFileBtn.disabled = true;
      this.genFileBtn.textContent = "Collecting Data...";
      
      this.fileInfoEl.innerHTML = `
        <strong>Collecting Random Data...</strong><br>
        Required: ${fileSize} bytes (${(fileSize / 1024).toFixed(2)} KB)<br>
        Collected: ${uintArray.length} bytes (${(uintArray.length / 1024).toFixed(2)} KB)<br>
        Progress: ${((uintArray.length / fileSize) * 100).toFixed(1)}%<br>
        <div style="background: #333; height: 8px; border-radius: 4px; margin-top: 8px;">
          <div style="background: #4caf50; height: 100%; width: ${(uintArray.length / fileSize) * 100}%; border-radius: 4px; transition: width 0.3s ease;"></div>
        </div>
      `;
      this.fileInfoEl.className = "file-info";
      this.downloadFileBtn.disabled = true;
      return;
    }

    // We have enough data, generate the file
    this.createFileFromData(uintArray, fileSize, fileName);
  }

  /**
   * Creates the actual file from the collected data
   * @param {number[]} uintArray - Array of random uint8 values
   * @param {number} fileSize - Size of file to create
   * @param {string} fileName - Name of the file
   */
  createFileFromData(uintArray, fileSize, fileName) {
    // Use only the exact amount of data needed (no repetition)
    const fileData = new Uint8Array(fileSize);
    for (let i = 0; i < fileSize; i++) {
      fileData[i] = uintArray[i];
    }

    // Create a Blob and store it
    this.generatedFile = new Blob([fileData], { type: 'application/octet-stream' });
    
    // Update UI
    this.fileInfoEl.innerHTML = `
      <strong>File Generated Successfully!</strong><br>
      Size: ${fileSize} bytes (${(fileSize / 1024).toFixed(2)} KB)<br>
      Name: ${fileName}<br>
      Data Source: ${fileSize} bytes of cryptographically secure random data<br>
      Ready for download.
    `;
    this.fileInfoEl.className = "file-info";
    this.downloadFileBtn.disabled = false;
    this.genFileBtn.disabled = false;
    this.genFileBtn.textContent = "Generate Random File";
    this.isGenerating = false;
  }

  /**
   * Updates the progress display during data collection
   * @param {number[]} uintArray - Current array of random uint8 values
   */
  updateProgress(uintArray) {
    if (!this.isGenerating || this.requiredDataSize === 0) return;

    const progress = (uintArray.length / this.requiredDataSize) * 100;
    
    this.fileInfoEl.innerHTML = `
      <strong>Collecting Random Data...</strong><br>
      Required: ${this.requiredDataSize} bytes (${(this.requiredDataSize / 1024).toFixed(2)} KB)<br>
      Collected: ${uintArray.length} bytes (${(uintArray.length / 1024).toFixed(2)} KB)<br>
      Progress: ${progress.toFixed(1)}%<br>
      <div style="background: #333; height: 8px; border-radius: 4px; margin-top: 8px;">
        <div style="background: #4caf50; height: 100%; width: ${Math.min(100, progress)}%; border-radius: 4px; transition: width 0.3s ease;"></div>
      </div>
    `;

    // Check if we now have enough data
    if (uintArray.length >= this.requiredDataSize) {
      this.createFileFromData(uintArray, this.requiredDataSize, this.fileNameEl.value || "random_data.bin");
    }
  }

  /**
   * Downloads the generated file
   */
  downloadFile() {
    if (!this.generatedFile) return;

    const fileName = this.fileNameEl.value || "random_data.bin";
    const url = URL.createObjectURL(this.generatedFile);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

// ============================================================================
// RANDOM NUMBER GENERATOR CLASS
// ============================================================================

class RandomNumberGenerator {
  constructor() {
    this.numCountEl = document.getElementById("numCount");
    this.numMinEl = document.getElementById("numMin");
    this.numMaxEl = document.getElementById("numMax");
    this.numHexEl = document.getElementById("numHex");
    this.numDecimalEl = document.getElementById("numDecimal");
    this.numBinaryEl = document.getElementById("numBinary");
    this.numbersBoxEl = document.getElementById("numbersBox");
    this.copyNumbersBtn = document.getElementById("copyNumbersBtn");
  }

  /**
   * Gets the currently selected number format
   * @returns {string} The selected format ('hex', 'decimal', or 'binary')
   */
  getSelectedFormat() {
    if (this.numHexEl.checked) return 'hex';
    if (this.numDecimalEl.checked) return 'decimal';
    if (this.numBinaryEl.checked) return 'binary';
    return 'hex'; // Default fallback
  }

  /**
   * Generates random numbers using the provided random data
   * @param {number[]} uintArray - Array of random uint8 values
   */
  generateNumbers(uintArray) {
    if (uintArray.length < 32) {
      this.numbersBoxEl.value = "Not enough random data yet. Wait for hashing...";
      this.copyNumbersBtn.disabled = true;
      return;
    }

    const count = Math.max(1, Math.min(10000, parseInt(this.numCountEl.value) || 100));
    const min = parseInt(this.numMinEl.value) || 0;
    const max = parseInt(this.numMaxEl.value) || 255;
    
    if (min >= max) {
      this.numbersBoxEl.value = "Error: Min value must be less than max value.";
      this.copyNumbersBtn.disabled = true;
      return;
    }

    const numbers = [];
    for (let i = 0; i < count; i++) {
      const randomValue = uintArray[i % uintArray.length];
      const scaledValue = min + (randomValue % (max - min + 1));
      numbers.push(scaledValue);
    }

    // Format numbers based on selected format
    const format = this.getSelectedFormat();
    let formattedNumbers = [];
    
    switch (format) {
      case 'hex':
        formattedNumbers = numbers.map(n => "0x" + n.toString(16).toUpperCase().padStart(2, "0"));
        break;
      case 'decimal':
        formattedNumbers = numbers.map(n => n.toString());
        break;
      case 'binary':
        formattedNumbers = numbers.map(n => "0b" + n.toString(2).padStart(8, "0"));
        break;
      default:
        formattedNumbers = numbers.map(n => "0x" + n.toString(16).toUpperCase().padStart(2, "0"));
    }

    this.numbersBoxEl.value = formattedNumbers.join(", ");
    this.copyNumbersBtn.disabled = false;
  }

  /**
   * Copies the generated numbers to clipboard
   */
  copyToClipboard() {
    this.numbersBoxEl.select();
    document.execCommand('copy');
    
    // Visual feedback
    const originalText = this.copyNumbersBtn.textContent;
    this.copyNumbersBtn.textContent = "Copied!";
    this.copyNumbersBtn.style.background = "#4caf50";
    
    setTimeout(() => {
      this.copyNumbersBtn.textContent = originalText;
      this.copyNumbersBtn.style.background = "";
    }, 2000);
  }
}

// ============================================================================
// TAB MANAGER CLASS
// ============================================================================

class TabManager {
  constructor() {
    this.tabButtons = document.querySelectorAll('.tab-button');
    this.tabPanels = document.querySelectorAll('.tab-panel');
    
    this.initializeTabs();
  }

  initializeTabs() {
    this.tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        const targetTab = button.getAttribute('data-tab');
        this.switchTab(targetTab);
      });
    });
  }

  switchTab(tabName) {
    // Remove active class from all buttons and panels
    this.tabButtons.forEach(btn => btn.classList.remove('active'));
    this.tabPanels.forEach(panel => panel.classList.remove('active'));

    // Add active class to clicked button and corresponding panel
    const activeButton = document.querySelector(`[data-tab="${tabName}"]`);
    const activePanel = document.getElementById(`${tabName}-tab`);
    
    if (activeButton && activePanel) {
      activeButton.classList.add('active');
      activePanel.classList.add('active');
    }
  }
}

// ============================================================================
// APPLICATION INITIALIZATION
// ============================================================================

// Create the main RNG instance
const audioRNG = new AudioRNG();
const passwordGenerator = audioRNG.passwordGenerator;
const fileGenerator = new FileGenerator();
const randomNumberGenerator = new RandomNumberGenerator();
const tabManager = new TabManager();

// Set the file generator reference in AudioRNG for progress updates
audioRNG.fileGenerator = fileGenerator;

// Set up event listeners
document.getElementById("genPwBtn").onclick = () => {
  passwordGenerator.generatePassword(audioRNG.getRandomData());
};

document.getElementById("genFileBtn").onclick = () => {
  fileGenerator.generateFile(audioRNG.getRandomData());
};

document.getElementById("downloadFileBtn").onclick = () => {
  fileGenerator.downloadFile();
};

document.getElementById("genNumbersBtn").onclick = () => {
  randomNumberGenerator.generateNumbers(audioRNG.getRandomData());
};

document.getElementById("copyNumbersBtn").onclick = () => {
  randomNumberGenerator.copyToClipboard();
};
