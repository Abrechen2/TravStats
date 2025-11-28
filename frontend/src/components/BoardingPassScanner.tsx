import { useState, useRef } from 'react';
import jsQR from 'jsqr';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { parseBCBP, BoardingPassData } from '../lib/bcbpParser';
import { useThemeStore } from '../store/themeStore';

interface BoardingPassScannerProps {
  onScanSuccess: (data: BoardingPassData) => void;
  onClose: () => void;
}

export default function BoardingPassScanner({ onScanSuccess, onClose }: BoardingPassScannerProps) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [scannedRawText, setScannedRawText] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDarkMode = useThemeStore((s) => s.isDarkMode);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');
    setScanning(true);

    try {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        setPreview(dataUrl);
        scanImage(dataUrl);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setError('Failed to read file');
      setScanning(false);
    }
  };

  const scanImage = async (dataUrl: string) => {
    const img = new Image();

    img.onload = async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      let barcodeText: string | null = null;
      let debugInfo: string[] = [];

      const scanAttempts = async () => {
        // Try multiple resolutions - important for Aztec codes!
        const resolutions = [
          { scale: 1.0, name: 'Original' },
          { scale: 0.5, name: '50%' },
          { scale: 1.5, name: '150%' },
          { scale: 2.0, name: '200%' },
        ];

        for (const resolution of resolutions) {
          debugInfo.push(`\n=== Trying resolution: ${resolution.name} ===`);

          // Set canvas size based on resolution
          canvas.width = img.width * resolution.scale;
          canvas.height = img.height * resolution.scale;
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          const originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

          // Different preprocessing strategies
          const preprocessingAttempts = [
            { name: 'Original', enhance: false },
            { name: 'High Contrast (Aztec optimized)', enhance: true, brightness: 1.3, contrast: 2.5, threshold: 128 },
            { name: 'Brightness Boost', enhance: true, brightness: 1.8, contrast: 1.5 },
            { name: 'Dark Mode Invert', enhance: true, invert: true, brightness: 1.2, contrast: 2.0 },
            { name: 'Extreme Contrast', enhance: true, brightness: 1.0, contrast: 3.0, threshold: 100 },
          ];

          for (const attempt of preprocessingAttempts) {
            debugInfo.push(`  → Preprocessing: ${attempt.name}`);
            ctx.putImageData(originalImageData, 0, 0);

            if (attempt.enhance) {
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const data = imageData.data;

              for (let i = 0; i < data.length; i += 4) {
                let r = data[i];
                let g = data[i + 1];
                let b = data[i + 2];

                // Convert to grayscale
                let gray = 0.299 * r + 0.587 * g + 0.114 * b;

                // Apply brightness and contrast
                gray = ((gray / 255 - 0.5) * (attempt.contrast || 1) + 0.5) * 255;
                gray *= attempt.brightness || 1;

                // Apply inversion if needed (for white-on-black codes)
                if (attempt.invert) {
                  gray = 255 - gray;
                }

                // Apply threshold if specified (binary conversion)
                if (attempt.threshold) {
                  gray = gray > attempt.threshold ? 255 : 0;
                }

                gray = Math.min(255, Math.max(0, gray));
                data[i] = data[i + 1] = data[i + 2] = gray;
              }
              ctx.putImageData(imageData, 0, 0);
            }

            // Try ZXing with comprehensive hints
            try {
              const hints = new Map();
              hints.set(DecodeHintType.POSSIBLE_FORMATS, [
                BarcodeFormat.AZTEC,         // Priority for Lufthansa
                BarcodeFormat.PDF_417,       // Common paper boarding pass
                BarcodeFormat.QR_CODE,       // Mobile boarding pass
                BarcodeFormat.DATA_MATRIX,   // Alternative format
              ]);
              hints.set(DecodeHintType.TRY_HARDER, true);
              hints.set(DecodeHintType.PURE_BARCODE, false); // Allow detection in noisy images

              const codeReader = new BrowserMultiFormatReader(hints);
              const result = await codeReader.decodeFromCanvas(canvas);
              if (result && result.getText()) {
                debugInfo.push(`    ✅ SUCCESS with ZXing: ${result.getBarcodeFormat()}`);
                return { text: result.getText(), debugInfo: debugInfo.join('\n') };
              }
            } catch (e: any) {
              debugInfo.push(`    ❌ ZXing failed: ${e.message || 'Unknown error'}`);
            }

            // Try jsQR as fallback (QR codes only)
            if (attempt.name === 'Original' || attempt.name === 'High Contrast (Aztec optimized)') {
              try {
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = jsQR(imageData.data, imageData.width, imageData.height, {
                  inversionAttempts: 'attemptBoth',
                });
                if (code && code.data) {
                  debugInfo.push(`    ✅ SUCCESS with jsQR`);
                  return { text: code.data, debugInfo: debugInfo.join('\n') };
                }
              } catch (e: any) {
                debugInfo.push(`    ❌ jsQR failed: ${e.message || 'Unknown error'}`);
              }
            }
          }
        }

        return { text: null, debugInfo: debugInfo.join('\n') };
      };

      const result = await scanAttempts();
      barcodeText = result.text;
      console.log('Scan Debug Info:\n' + result.debugInfo);

      if (barcodeText) {
        setScannedRawText(barcodeText); // Save for debug mode
        const bcbpData = parseBCBP(barcodeText);
        if (bcbpData) {
          setScanning(false);
          onScanSuccess(bcbpData);
        } else {
          setError(`Barcode found but format not recognized. Enable debug mode to see raw data.`);
          setScanning(false);
        }
      } else {
        setScannedRawText(`DEBUG INFO:\n${result.debugInfo}\n\nNo barcode detected in any attempt.`);
        setError('No barcode found. Enable debug mode to see detailed scan attempts. Tips: good lighting, focus the 2D barcode (PDF417/QR/Aztec).');
        setScanning(false);
      }
    };

    img.onerror = () => {
      setError('Failed to load image');
      setScanning(false);
    };

    img.src = dataUrl;
  };

  const handleTryAgain = () => {
    setError('');
    setPreview(null);
    setScanning(false);
    setScannedRawText(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
      <div className={`${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'} rounded-lg max-w-2xl w-full p-6 shadow-2xl`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold">Scan Boarding Pass</h2>
          <button onClick={onClose} className={`${isDarkMode ? 'text-gray-300 hover:text-white' : 'text-gray-500 hover:text-gray-700'}`}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {!preview && (
          <div className="mb-6">
            <p className={`${isDarkMode ? 'text-gray-300' : 'text-gray-600'} mb-4`}>
              Upload a photo of your boarding pass barcode. We support standard IATA formats and can intelligently extract data from most boarding passes!
            </p>
            <div className={`${isDarkMode ? 'bg-blue-900/40 border-blue-700 text-blue-100' : 'bg-blue-50 border-blue-200 text-gray-800'} border rounded-lg p-4`}>
              <h3 className="font-semibold mb-2">✅ Supported barcode types:</h3>
              <ul className="text-sm space-y-1 mb-3">
                <li>✈️ PDF417 (standard paper boarding passes)</li>
                <li>📱 QR Code (mobile boarding passes)</li>
                <li>🎯 Aztec Code (some airlines like Lufthansa)</li>
                <li>🔍 Auto-detection of non-standard formats</li>
              </ul>
              <h3 className="font-semibold mb-2">💡 Tips for best results:</h3>
              <ul className="text-sm space-y-1">
                <li>📸 Good lighting and focus on the 2D barcode</li>
                <li>🎯 Center the barcode in the photo</li>
                <li>🔲 Avoid glare and shadows</li>
                <li>🔍 If scanning fails, enable debug mode to see raw data</li>
              </ul>
            </div>
          </div>
        )}

        {preview && (
          <div className="mb-4">
            <img
              src={preview}
              alt="Boarding pass preview"
              className={`max-w-full max-h-80 object-contain rounded-lg border ${isDarkMode ? 'border-gray-700' : 'border-gray-200'} mx-auto`}
            />
          </div>
        )}

        {error && (
          <div className={`mb-4 px-4 py-3 rounded border ${isDarkMode ? 'bg-red-900 border-red-700 text-red-100' : 'bg-red-100 border-red-400 text-red-700'}`}>
            {error}
          </div>
        )}

        {scannedRawText && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                🔍 Debug Mode
              </label>
              <button
                type="button"
                onClick={() => setDebugMode(!debugMode)}
                className={`text-xs px-3 py-1 rounded ${
                  debugMode
                    ? 'bg-blue-500 text-white'
                    : isDarkMode
                    ? 'bg-gray-700 text-gray-300'
                    : 'bg-gray-200 text-gray-700'
                }`}
              >
                {debugMode ? 'Hide Raw Data' : 'Show Raw Data'}
              </button>
            </div>
            {debugMode && (
              <div className={`p-3 rounded border max-h-64 overflow-auto ${isDarkMode ? 'bg-gray-900 border-gray-700 text-gray-300' : 'bg-gray-50 border-gray-300 text-gray-800'}`}>
                <div className="text-xs font-mono break-all whitespace-pre-wrap">
                  {scannedRawText}
                </div>
                <div className="mt-2 pt-2 border-t border-gray-600">
                  <div className="text-xs">
                    <strong>Length:</strong> {scannedRawText.length} characters
                  </div>
                  <div className="text-xs">
                    <strong>First 10 chars:</strong> {scannedRawText.substring(0, 10)}
                  </div>
                  <div className="text-xs">
                    <strong>Format:</strong> {scannedRawText.startsWith('M') ? 'IATA BCBP' : scannedRawText.startsWith('http') ? 'URL/Web' : 'Unknown/Proprietary'}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileSelect}
            className="hidden"
            id="boarding-pass-upload"
          />

          {!preview ? (
            <label htmlFor="boarding-pass-upload" className="btn-primary w-full cursor-pointer text-center block">
              Take Photo / Upload Image
            </label>
          ) : (
            <div className="flex gap-3">
              <button onClick={handleTryAgain} className="btn-secondary flex-1">
                Try Again
              </button>
              {scanning && (
                <button disabled className="btn-primary flex-1">
                  Scanning...
                </button>
              )}
            </div>
          )}

          <button onClick={onClose} className="btn-secondary w-full">
            Cancel
          </button>
        </div>

        <canvas ref={canvasRef} className="hidden" />

        <div className={`mt-6 text-xs text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          <p>Your boarding pass data is processed locally and never sent to any server.</p>
        </div>
      </div>
    </div>
  );
}
