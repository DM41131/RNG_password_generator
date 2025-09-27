"use strict";

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
function bitsToUint8(bits) {
  let value = 0;
  for (let i = 0; i < bits.length; i++) value = (value << 1) | bits[i];
  return value;
}

function buf2hex(buffer) {
  return [...buffer].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function sha256String(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hashBuffer);
}

// ============================================================================
// VISUALIZATION MANAGER (now with WATERFALL mode)
// ============================================================================
class VisualizationManager {
  constructor() {
    // Optional canvases (guards included)
    this.waveformCanvas = document.getElementById("waveform") || null;
    this.waveCtx = this.waveformCanvas ? this.waveformCanvas.getContext("2d") : null;

    this.histCanvas = document.getElementById("histogram") || null;
    this.histCtx = this.histCanvas ? this.histCanvas.getContext("2d") : null;

    this.bitMatrixCanvas = document.getElementById("bitMatrix") || null;
    this.bitMatrixCtx = this.bitMatrixCanvas ? this.bitMatrixCanvas.getContext("2d") : null;

    // Geometry
    this.matrixWidth = 200;  // columns (bits per row)
    this.matrixHeight = 100; // rows
    this.pixelSize = 2;      // on-screen scale

    // Rendering mode: "waterfall" | "grid"
    this.renderMode = "waterfall";
    this.newestOnTop = true; // waterfall direction: true => new row at top

    // Visible size
    this.canvasWidth = this.matrixWidth * this.pixelSize;
    this.canvasHeight = this.matrixHeight * this.pixelSize;

    // Offscreen buffer (1:1 logical pixels)
    this.offscreen = document.createElement("canvas");
    this.offscreen.width = this.matrixWidth;
    this.offscreen.height = this.matrixHeight;
    this.offctx = this.offscreen.getContext("2d", { willReadFrequently: true });

    // Row buffer for fast line injection
    this.rowImage = this.offctx.createImageData(this.matrixWidth, 1);

    // Colors (binary palette)
    this.colorZero = [255, 255, 255]; // 0-bit -> white
    this.colorOne  = [0, 0, 0];       // 1-bit -> black

    // State for bit streaming
    this.lastBitCount = 0;     // total bits consumed so far
    this.capacity = this.matrixWidth * this.matrixHeight;
    this.rowAccumulator = [];   // collect bits until a full row is ready

    // Optional grid overlay
    this.showGrid = false;

    // Init canvases
    this.updateCanvasSize();
    this._clearOffscreenToWhite();

    if (this.bitMatrixCanvas) this.bitMatrixCanvas.style.imageRendering = "pixelated";
  }

  // --- Public toggles ---
  setWaterfallDirection(dir /* "down" | "up" */) {
    this.newestOnTop = dir === "down"; // SDR "waterfall down" => newest at top, scroll down
  }
  setWaterfallColors(rgbZero, rgbOne) {
    if (Array.isArray(rgbZero) && rgbZero.length === 3) this.colorZero = rgbZero.slice(0,3);
    if (Array.isArray(rgbOne) && rgbOne.length === 3) this.colorOne  = rgbOne.slice(0,3);
  }
  setRenderMode(mode /* "waterfall" | "grid" */) {
    this.renderMode = mode === "grid" ? "grid" : "waterfall";
    this.resetBitMatrix();
  }

  // --- Canvas sizing ---
  updateCanvasSize() {
    if (!this.bitMatrixCanvas) return;
    this.bitMatrixCanvas.width = this.canvasWidth;
    this.bitMatrixCanvas.height = this.canvasHeight;
    if (this.bitMatrixCtx) this.bitMatrixCtx.imageSmoothingEnabled = false;
  }

  // --- Clearing ---
  _clearOffscreenToWhite() {
    this.offctx.save();
    this.offctx.fillStyle = "#ffffff";
    this.offctx.fillRect(0, 0, this.matrixWidth, this.matrixHeight);
    this.offctx.restore();
  }

  // --- Histogram ---
  drawHistogram(uintArray) {
    if (!this.histCtx || !this.histCanvas) return;
    const histogram = new Array(256).fill(0);
    for (let i = 0; i < uintArray.length; i++) histogram[uintArray[i]]++;

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

  // --- Waveform ---
  drawWaveform(data) {
    if (!this.waveCtx || !this.waveformCanvas) return;
    const w = this.waveformCanvas.width;
    const h = this.waveformCanvas.height;
    this.waveCtx.clearRect(0, 0, w, h);
    this.waveCtx.beginPath();
    this.waveCtx.strokeStyle = "#0f0";
    this.waveCtx.lineWidth = 2;
    for (let i = 0; i < data.length; i++) {
      const x = (i / (data.length - 1)) * w;
      const y = (data[i] / 255) * h;
      if (i === 0) this.waveCtx.moveTo(x, y);
      else this.waveCtx.lineTo(x, y);
    }
    this.waveCtx.stroke();
  }

  // --- Main draw entry ---
  drawBitMatrix(uintArray) {
    if (this.renderMode === "waterfall") this._drawBitWaterfall(uintArray);
    else this._drawBitGrid(uintArray); // optional fallback
  }

  // --- WATERFALL RENDERING ---
  _drawBitWaterfall(uintArray) {
    if (!this.bitMatrixCanvas || !this.bitMatrixCtx) return;

    const totalBits = uintArray.length * 8;
    if (totalBits <= this.lastBitCount) return;

    // Consume new bits → fill rows
    const rowW = this.matrixWidth;
    const rowData = this.rowImage.data;

    // Helper: commit one row to offscreen (scroll + draw)
    const commitRow = (bitsRow /* length = rowW */) => {
      // Fill row image pixels
      for (let x = 0; x < rowW; x++) {
        const b = bitsRow[x] ? this.colorOne : this.colorZero;
        const idx = x * 4;
        rowData[idx]     = b[0];
        rowData[idx + 1] = b[1];
        rowData[idx + 2] = b[2];
        rowData[idx + 3] = 255;
      }

      if (this.newestOnTop) {
        // Scroll down by 1 row: copy [0..H-2] → [1..H-1]
        this.offctx.drawImage(
          this.offscreen,
          0, 0, this.matrixWidth, this.matrixHeight - 1,
          0, 1, this.matrixWidth, this.matrixHeight - 1
        );
        // Put new row at top (y=0)
        this.offctx.putImageData(this.rowImage, 0, 0);
      } else {
        // Newest at bottom: scroll up by 1 row
        this.offctx.drawImage(
          this.offscreen,
          0, 1, this.matrixWidth, this.matrixHeight - 1,
          0, 0, this.matrixWidth, this.matrixHeight - 1
        );
        // Put new row at bottom (y=H-1)
        this.offctx.putImageData(this.rowImage, 0, this.matrixHeight - 1);
      }
    };

    // Pull bits from uintArray starting at lastBitCount
    const pullBit = (bitIndex) => {
      const byteIndex = bitIndex >> 3;
      const bitIndexInByte = 7 - (bitIndex & 7);
      return (uintArray[byteIndex] >> bitIndexInByte) & 1;
    };

    // Accumulate bits until we can emit rows
    for (let i = this.lastBitCount; i < totalBits; i++) {
      this.rowAccumulator.push(pullBit(i));

      if (this.rowAccumulator.length >= rowW) {
        const row = this.rowAccumulator.slice(0, rowW);
        this.rowAccumulator = this.rowAccumulator.slice(rowW);
        commitRow(row);
      }
    }

    // Update pointer
    this.lastBitCount = totalBits;

    // Present offscreen → visible (scaled, pixelated)
    this.bitMatrixCtx.imageSmoothingEnabled = false;
    this.bitMatrixCtx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
    this.bitMatrixCtx.drawImage(this.offscreen, 0, 0, this.canvasWidth, this.canvasHeight);

    // Grid overlay if desired
    if (this.showGrid) this._drawGrid();
  }

  // --- GRID RENDERING (optional; keeps prior behavior as fallback) ---
  _drawBitGrid(uintArray) {
    if (!this.bitMatrixCanvas || !this.bitMatrixCtx) return;

    const totalBits = uintArray.length * 8;
    if (totalBits <= this.lastBitCount) return;

    // Paint only the new bits into the whole matrix buffer (wrap)
    const w = this.matrixWidth;
    const h = this.matrixHeight;

    const img = this.offctx.getImageData(0, 0, w, h);
    const data = img.data;

    const paintOne = (pos /* 0..capacity-1 */, bit) => {
      const y = Math.floor(pos / w);
      const x = pos - y * w;
      const base = (y * w + x) * 4;
      const clr = bit ? this.colorOne : this.colorZero;
      data[base]     = clr[0];
      data[base + 1] = clr[1];
      data[base + 2] = clr[2];
      data[base + 3] = 255;
    };

    const cap = this.capacity;
    const pullBit = (i) => {
      const byteIndex = i >> 3;
      const bitIndexInByte = 7 - (i & 7);
      return (uintArray[byteIndex] >> bitIndexInByte) & 1;
    };

    const MAX_BITS_PER_PASS = 20000;
    let next = this.lastBitCount;
    while (next < totalBits) {
      const end = Math.min(totalBits, next + MAX_BITS_PER_PASS);
      for (; next < end; next++) {
        const bit = pullBit(next);
        const pos = next % cap;
        paintOne(pos, bit);
      }
      // commit chunk
      this.offctx.putImageData(img, 0, 0);
    }

    this.lastBitCount = totalBits;

    this.bitMatrixCtx.imageSmoothingEnabled = false;
    this.bitMatrixCtx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
    this.bitMatrixCtx.drawImage(this.offscreen, 0, 0, this.canvasWidth, this.canvasHeight);
    if (this.showGrid) this._drawGrid();
  }

  // --- Optional grid overlay ---
  _drawGrid() {
    const ctx = this.bitMatrixCtx;
    if (!ctx) return;

    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.lineWidth = 1;

    for (let x = 0; x <= this.matrixWidth; x += 10) {
      const sx = x * this.pixelSize + 0.5;
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, this.canvasHeight); ctx.stroke();
    }
    for (let y = 0; y <= this.matrixHeight; y += 10) {
      const sy = y * this.pixelSize + 0.5;
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(this.canvasWidth, sy); ctx.stroke();
    }
    ctx.restore();
  }

  // --- Resets ---
  resetBitMatrix() {
    this.lastBitCount = 0;
    this.rowAccumulator = [];
    this._clearOffscreenToWhite();
    if (this.bitMatrixCtx) {
      this.bitMatrixCtx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
      this.bitMatrixCtx.drawImage(this.offscreen, 0, 0, this.canvasWidth, this.canvasHeight);
    }
  }

  setMatrixSize(cols, rows, pixelSize = this.pixelSize) {
    this.matrixWidth = Math.max(1, cols | 0);
    this.matrixHeight = Math.max(1, rows | 0);
    this.pixelSize = Math.max(1, pixelSize | 0);
    this.canvasWidth = this.matrixWidth * this.pixelSize;
    this.canvasHeight = this.matrixHeight * this.pixelSize;
    this.capacity = this.matrixWidth * this.matrixHeight;

    this.offscreen.width = this.matrixWidth;
    this.offscreen.height = this.matrixHeight;
    this.offctx = this.offscreen.getContext("2d", { willReadFrequently: true });
    this.rowImage = this.offctx.createImageData(this.matrixWidth, 1);

    this.updateCanvasSize();
    this.resetBitMatrix();
  }
}

// ============================================================================
// PASSWORD GENERATOR
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
  generatePassword(uintArray) {
    if (!this.passwordBox) return;
    if (uintArray.length < 32) {
      this.passwordBox.value = "Not enough random data yet. Wait for hashing...";
      return;
    }
    let charset = "";
    if (this.chkUpper?.checked) charset += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (this.chkLower?.checked) charset += "abcdefghijklmnopqrstuvwxyz";
    if (this.chkNums?.checked) charset += "0123456789";
    if (this.chkSyms?.checked) charset += "!@#$%^&*()-_=+[]{};:,.<>?";
    if (charset.length === 0) {
      this.passwordBox.value = "Please select at least one character set.";
      return;
    }
    const pwLength = Math.max(8, Math.min(64, parseInt(this.pwLengthEl?.value || "16")));
    let password = "";
    for (let i = 0; i < pwLength; i++) {
      const r = uintArray[(i + uintArray.length - pwLength) % uintArray.length];
      password += charset[r % charset.length];
    }
    this.passwordBox.value = password;
    
    // Reset data buffer after password generation
    if (window.audioRNG) {
      window.audioRNG.resetDataBuffer();
    }
  }
}

// ============================================================================
// AUDIO RNG (unchanged except it calls drawBitMatrix → now waterfall)
// ============================================================================
class AudioRNG {
  constructor() {
    this.bitsEl = document.getElementById("bits");
    this.uintArrayEl = document.getElementById("uintArray");
    this.hashOutput = document.getElementById("hashOutput");
    this.levelBar = document.getElementById("levelBar");
    this.levelText = document.getElementById("levelText");

    this.inputDeviceSelect = document.getElementById("inputDevice");
    this.gainSlider = document.getElementById("gainSlider");
    this.gainValue = document.getElementById("gainValue");
    this.startBtn = document.getElementById("startBtn");
    this.stopBtn = document.getElementById("stopBtn");
    this.refreshDevicesBtn = document.getElementById("refreshDevicesBtn");
    this.waveformInfo = document.getElementById("waveformInfo");
    this.compactLevelBar = document.getElementById("compactLevelBar");
    this.compactLevelText = document.getElementById("compactLevelText");

    this.audioCtx = null;
    this.analyser = null;
    this.gainNode = null;
    this.source = null;
    this.stream = null;

    this.rawBitBuffer = [];
    this.finalBitBuffer = [];
    this.collectedNumbers = [];
    this.uintArray = [];

    this.visualizationManager = new VisualizationManager();
    // Optional: change waterfall direction/colors
    // this.visualizationManager.setWaterfallDirection("down"); // newest at top (default)
    // this.visualizationManager.setWaterfallColors([255,255,255],[0,0,0]); // 0->white,1->black

    this.passwordGenerator = new PasswordGenerator();
    this.fileGenerator = null;

    this.animationFrameId = null;
    this.initializeControls();
  }

  initializeControls() {
    this.gainSlider?.addEventListener("input", (e) => {
      const val = Number(e.target.value);
      if (this.gainValue) this.gainValue.textContent = `${val}%`;
      if (this.gainNode) this.gainNode.gain.value = val / 100;
    });

    this.inputDeviceSelect?.addEventListener("change", (e) => {
      const id = e.target.value;
      if (id && this.audioCtx) this.restartWithDevice(id);
    });

    this.refreshDevicesBtn?.addEventListener("click", () => this.loadAudioDevices());
    this.startBtn?.addEventListener("click", () => this.start());
    this.stopBtn?.addEventListener("click", () => this.stop());

    this.loadAudioDevices();
  }

  async loadAudioDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === "audioinput");
      if (!this.inputDeviceSelect) return;
      this.inputDeviceSelect.innerHTML = '<option value="">Select input device...</option>';
      audioInputs.forEach((device, idx) => {
        const o = document.createElement("option");
        o.value = device.deviceId;
        o.textContent = device.label || `Microphone ${idx + 1}`;
        this.inputDeviceSelect.appendChild(o);
      });
    } catch (e) {
      console.error("Error loading audio devices:", e);
      if (this.waveformInfo) this.waveformInfo.textContent = "Error loading audio devices";
    }
  }

  async restartWithDevice(deviceId) {
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
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
    } catch (e) {
      console.error("Error switching device:", e);
      if (this.waveformInfo) this.waveformInfo.textContent = "Error switching to selected device";
    }
  }

  setupAudioContext() {
    if (this.audioCtx) this.audioCtx.close();
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this.source = this.audioCtx.createMediaStreamSource(this.stream);

    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.value = (Number(this.gainSlider?.value) || 100) / 100;

    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;

    this.source.connect(this.gainNode);
    this.gainNode.connect(this.analyser);

    if (this.waveformInfo) this.waveformInfo.textContent = "Audio connected - Click Start RNG to begin";
  }

  async processSamples(data) {
    for (let i = 0; i < data.length; i++) {
      const bit = data[i] & 1;
      this.rawBitBuffer.push(bit);

      if (this.rawBitBuffer.length >= 2) {
        const b1 = this.rawBitBuffer.shift();
        const b2 = this.rawBitBuffer.shift();
        if (b1 === 0 && b2 === 1) this.finalBitBuffer.push(0);
        else if (b1 === 1 && b2 === 0) this.finalBitBuffer.push(1);

        if (this.finalBitBuffer.length === 8) {
          const uint8 = bitsToUint8(this.finalBitBuffer);
          this.collectedNumbers.push(uint8);
          this.finalBitBuffer = [];

          if (this.collectedNumbers.length >= 1000) {
            const asciiString = String.fromCharCode(...this.collectedNumbers.slice(0, 1000));
            const digest = await sha256String(asciiString);
            this.uintArray.push(...digest);
            this.collectedNumbers = [];

            if (this.uintArrayEl) this.uintArrayEl.value = this.uintArray.slice(-50).join(", ");
            if (this.hashOutput) this.hashOutput.textContent = "Last SHA-256 Hash (hex): " + buf2hex(digest);

            this.visualizationManager.drawHistogram(this.uintArray);
            this.visualizationManager.drawBitMatrix(this.uintArray);

            if (this.fileGenerator?.isGenerating) this.fileGenerator.updateProgress(this.uintArray);
          }
        }
      }
    }
    if (this.bitsEl) {
      this.bitsEl.textContent =
        `Current unbiased bits (${this.finalBitBuffer.length}/8): ` + this.finalBitBuffer.join("");
    }
  }

  updateLevelMeter(data) {
    if (!this.levelBar || !this.levelText || !this.compactLevelBar || !this.compactLevelText) return;
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const sample = (data[i] - 128) / 128;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / data.length);
    
    // Convert to logarithmic scale (dB)
    // Add small epsilon to avoid log(0)
    const rmsDb = 20 * Math.log10(Math.max(rms, 0.0001));
    
    // Map dB range to 0-100% display
    // Typical audio range: -60dB to 0dB maps to 0-100%
    const minDb = -60;
    const maxDb = 0;
    const normalizedDb = Math.max(0, Math.min(1, (rmsDb - minDb) / (maxDb - minDb)));
    const level = normalizedDb * 100;

    this.levelBar.style.width = `${level}%`;
    this.levelText.textContent = `Level: ${Math.round(level)}% (${Math.round(rmsDb)}dB)`;
    this.compactLevelBar.style.setProperty("--level", `${level}%`);
    this.compactLevelText.textContent = `${Math.round(level)}%`;

    // Keep level meter green without gradient
    this.levelBar.style.background = "#4caf50";
  }

  drawLoop() {
    this.animationFrameId = requestAnimationFrame(() => this.drawLoop());
    if (!this.analyser) return;
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    this.processSamples(data);
    this.updateLevelMeter(data);
    this.visualizationManager.drawWaveform(data);
  }

  async start() {
    try {
      const deviceId = this.inputDeviceSelect?.value;
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
      this.visualizationManager.resetBitMatrix();
      this.drawLoop();

      if (this.startBtn) { this.startBtn.disabled = true; this.startBtn.textContent = "🎤 RNG Running..."; }
      if (this.stopBtn) this.stopBtn.disabled = false;
      if (this.waveformInfo) this.waveformInfo.textContent = "RNG is running - generating random numbers";
      return true;
    } catch (e) {
      console.error("Error starting audio RNG:", e);
      if (this.waveformInfo) this.waveformInfo.textContent = "Error starting audio capture: " + e.message;
      return false;
    }
  }

  stop() {
    if (this.animationFrameId) { cancelAnimationFrame(this.animationFrameId); this.animationFrameId = null; }
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    if (this.audioCtx) { this.audioCtx.close(); this.audioCtx = null; }

    this.analyser = null; this.gainNode = null; this.source = null;

    if (this.startBtn) { this.startBtn.disabled = false; this.startBtn.textContent = "🎤 Start RNG"; }
    if (this.stopBtn) this.stopBtn.disabled = true;
    if (this.waveformInfo) this.waveformInfo.textContent = "RNG stopped - Click Start RNG to begin again";

    if (this.levelBar) this.levelBar.style.width = "0%";
    if (this.levelText) this.levelText.textContent = "Level: 0% (-∞dB)";
    if (this.compactLevelBar) this.compactLevelBar.style.setProperty("--level", "0%");
    if (this.compactLevelText) this.compactLevelText.textContent = "0%";

    if (this.fileGenerator) {
      this.fileGenerator.isGenerating = false;
      this.fileGenerator.requiredDataSize = 0;
      if (this.fileGenerator.genFileBtn) {
        this.fileGenerator.genFileBtn.disabled = false;
        this.fileGenerator.genFileBtn.textContent = "Generate Random File";
      }
      if (this.fileGenerator.downloadFileBtn) this.fileGenerator.downloadFileBtn.disabled = true;
      if (this.fileGenerator.fileInfoEl) {
        this.fileGenerator.fileInfoEl.textContent = "Start RNG to begin collecting random data for file generation.";
        this.fileGenerator.fileInfoEl.className = "file-info";
      }
    }
  }

  getRandomData() { return this.uintArray; }

  // Reset data buffers
  resetDataBuffer() {
    this.rawBitBuffer = [];
    this.finalBitBuffer = [];
    this.collectedNumbers = [];
    this.uintArray = [];
    this.visualizationManager.resetBitMatrix();
    
    // Reset UI elements
    if (this.bitsEl) this.bitsEl.textContent = "Current unbiased bits (0/8): ";
    if (this.uintArrayEl) this.uintArrayEl.value = "";
    if (this.hashOutput) this.hashOutput.textContent = "";
  }
}

// ============================================================================
// FILE GENERATOR
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

    if (this.fileInfoEl) {
      this.fileInfoEl.textContent = "Start RNG to begin collecting random data for file generation.";
      this.fileInfoEl.className = "file-info";
    }
  }

  generateFile(uintArray) {
    const fileSize = Math.max(1, Math.min(10_485_760, parseInt(this.fileSizeEl?.value || "1024")));
    const fileName = (this.fileNameEl?.value || "random_data.bin").trim();

    if (uintArray.length < fileSize) {
      this.requiredDataSize = fileSize;
      this.isGenerating = true;
      if (this.genFileBtn) { this.genFileBtn.disabled = true; this.genFileBtn.textContent = "Collecting Data..."; }
      if (this.fileInfoEl) {
        const pct = ((uintArray.length / fileSize) * 100).toFixed(1);
        this.fileInfoEl.innerHTML = `
          <strong>Collecting Random Data...</strong><br>
          Required: ${fileSize} bytes (${(fileSize / 1024).toFixed(2)} KB)<br>
          Collected: ${uintArray.length} bytes (${(uintArray.length / 1024).toFixed(2)} KB)<br>
          Progress: ${pct}%<br>
          <div style="background:#333;height:8px;border-radius:4px;margin-top:8px;">
            <div style="background:#4caf50;height:100%;width:${pct}%;border-radius:4px;transition:width .3s ease;"></div>
          </div>
        `;
        this.fileInfoEl.className = "file-info";
      }
      if (this.downloadFileBtn) this.downloadFileBtn.disabled = true;
      return;
    }

    this.createFileFromData(uintArray, fileSize, fileName);
  }

  createFileFromData(uintArray, fileSize, fileName) {
    const fileData = new Uint8Array(fileSize);
    for (let i = 0; i < fileSize; i++) fileData[i] = uintArray[i];

    this.generatedFile = new Blob([fileData], { type: "application/octet-stream" });

    if (this.fileInfoEl) {
      this.fileInfoEl.innerHTML = `
        <strong>File Generated Successfully!</strong><br>
        Size: ${fileSize} bytes (${(fileSize / 1024).toFixed(2)} KB)<br>
        Name: ${fileName}<br>
        Data Source: ${fileSize} bytes of cryptographically secure random data<br>
        Ready for download.
      `;
      this.fileInfoEl.className = "file-info";
    }
    if (this.downloadFileBtn) this.downloadFileBtn.disabled = false;
    if (this.genFileBtn) { this.genFileBtn.disabled = false; this.genFileBtn.textContent = "Generate Random File"; }
    this.isGenerating = false;
    
    // Reset data buffer after file generation
    if (window.audioRNG) {
      window.audioRNG.resetDataBuffer();
    }
  }

  updateProgress(uintArray) {
    if (!this.isGenerating || this.requiredDataSize === 0 || !this.fileInfoEl) return;

    const progress = (uintArray.length / this.requiredDataSize) * 100;
    this.fileInfoEl.innerHTML = `
      <strong>Collecting Random Data...</strong><br>
      Required: ${this.requiredDataSize} bytes (${(this.requiredDataSize / 1024).toFixed(2)} KB)<br>
      Collected: ${uintArray.length} bytes (${(uintArray.length / 1024).toFixed(2)} KB)<br>
      Progress: ${progress.toFixed(1)}%<br>
      <div style="background:#333;height:8px;border-radius:4px;margin-top:8px;">
        <div style="background:#4caf50;height:100%;width:${Math.min(100, progress)}%;border-radius:4px;transition:width .3s ease;"></div>
      </div>
    `;
    if (uintArray.length >= this.requiredDataSize) {
      this.createFileFromData(uintArray, this.requiredDataSize, (this.fileNameEl?.value || "random_data.bin").trim());
    }
  }

  downloadFile() {
    if (!this.generatedFile) return;
    const fileName = (this.fileNameEl?.value || "random_data.bin").trim();
    const url = URL.createObjectURL(this.generatedFile);
    const a = document.createElement("a");
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

// ============================================================================
// RANDOM NUMBER GENERATOR
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

  getSelectedFormat() {
    if (this.numHexEl?.checked) return "hex";
    if (this.numDecimalEl?.checked) return "decimal";
    if (this.numBinaryEl?.checked) return "binary";
    return "hex";
  }

  generateNumbers(uintArray) {
    if (!this.numbersBoxEl) return;
    if (uintArray.length < 32) {
      this.numbersBoxEl.value = "Not enough random data yet. Wait for hashing...";
      if (this.copyNumbersBtn) this.copyNumbersBtn.disabled = true;
      return;
    }

    const count = Math.max(1, Math.min(10000, parseInt(this.numCountEl?.value || "100")));
    const min = parseInt(this.numMinEl?.value || "0");
    const max = parseInt(this.numMaxEl?.value || "255");
    if (min >= max) {
      this.numbersBoxEl.value = "Error: Min value must be less than max value.";
      if (this.copyNumbersBtn) this.copyNumbersBtn.disabled = true;
      return;
    }

    const numbers = [];
    for (let i = 0; i < count; i++) {
      const rv = uintArray[i % uintArray.length];
      numbers.push(min + (rv % (max - min + 1)));
    }

    const fmt = this.getSelectedFormat();
    let out;
    if (fmt === "hex") out = numbers.map(n => "0x" + n.toString(16).toUpperCase().padStart(2, "0"));
    else if (fmt === "decimal") out = numbers.map(n => String(n));
    else out = numbers.map(n => "0b" + n.toString(2).padStart(8, "0"));

    this.numbersBoxEl.value = out.join(", ");
    if (this.copyNumbersBtn) this.copyNumbersBtn.disabled = false;
    
    // Reset data buffer after number generation
    if (window.audioRNG) {
      window.audioRNG.resetDataBuffer();
    }
  }

  copyToClipboard() {
    if (!this.numbersBoxEl) return;
    this.numbersBoxEl.select();
    document.execCommand("copy");
    if (!this.copyNumbersBtn) return;
    const t = this.copyNumbersBtn.textContent;
    this.copyNumbersBtn.textContent = "Copied!";
    this.copyNumbersBtn.style.background = "#4caf50";
    setTimeout(() => {
      this.copyNumbersBtn.textContent = t;
      this.copyNumbersBtn.style.background = "";
    }, 2000);
  }
}

// ============================================================================
// APP INIT
// ============================================================================
const audioRNG = new AudioRNG();
// Make audioRNG globally accessible for reset functionality
window.audioRNG = audioRNG;
const passwordGenerator = audioRNG.passwordGenerator;
const fileGenerator = new FileGenerator();
const randomNumberGenerator = new RandomNumberGenerator();
const tabManager = new (class TabManager {
  constructor() {
    this.tabButtons = document.querySelectorAll(".tab-button");
    this.tabPanels = document.querySelectorAll(".tab-panel");
    this.tabButtons.forEach(btn => btn.addEventListener("click", () => {
      const t = btn.getAttribute("data-tab");
      this.switchTab(t);
    }));
  }
  switchTab(tabName) {
    if (!tabName) return;
    this.tabButtons.forEach(b => b.classList.remove("active"));
    this.tabPanels.forEach(p => p.classList.remove("active"));
    document.querySelector(`.tab-button[data-tab="${tabName}"]`)?.classList.add("active");
    document.getElementById(`${tabName}-tab`)?.classList.add("active");
  }
})();

// Link RNG ↔ file progress
audioRNG.fileGenerator = fileGenerator;

// Buttons
document.getElementById("genPwBtn")?.addEventListener("click", () => {
  passwordGenerator.generatePassword(audioRNG.getRandomData());
});
document.getElementById("genFileBtn")?.addEventListener("click", () => {
  fileGenerator.generateFile(audioRNG.getRandomData());
});
document.getElementById("downloadFileBtn")?.addEventListener("click", () => {
  fileGenerator.downloadFile();
});
document.getElementById("genNumbersBtn")?.addEventListener("click", () => {
  randomNumberGenerator.generateNumbers(audioRNG.getRandomData());
});
document.getElementById("copyNumbersBtn")?.addEventListener("click", () => {
  randomNumberGenerator.copyToClipboard();
});
