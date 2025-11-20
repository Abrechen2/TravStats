import { useState, useRef } from 'react';
import jsQR from 'jsqr';
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from '@zxing/library';
import { parseBCBP, getAirlineName, BoardingPassData } from '../lib/bcbpParser';

interface BoardingPassScannerProps {
  onScanSuccess: (data: BoardingPassData) => void;
  onClose: () => void;
}

export default function BoardingPassScanner({ onScanSuccess, onClose }: BoardingPassScannerProps) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');
    setScanning(true);

    try {
      // Create image preview
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

      // Set canvas size to image size
      canvas.width = img.width;
      canvas.height = img.height;

      // Draw image
      ctx.drawImage(img, 0, 0);

      let barcodeText: string | null = null;

      try {
        // Try ZXing first (supports PDF417, QR, Aztec, etc.)
        // Configure hints for better detection
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.PDF_417,    // Paper boarding passes
          BarcodeFormat.QR_CODE,    // Mobile boarding passes
          BarcodeFormat.AZTEC,      // Some airlines use Aztec
          BarcodeFormat.DATA_MATRIX // Alternative format
        ]);
        hints.set(DecodeHintType.TRY_HARDER, true);

        // Pass hints to constructor
        const codeReader = new BrowserMultiFormatReader(hints);

        const result = await codeReader.decodeFromCanvas(canvas);
        if (result && result.getText()) {
          barcodeText = result.getText();
          console.log('✅ ZXing detected barcode:', result.getBarcodeFormat());
        }
      } catch (zxingError) {
        console.log('ZXing scan failed, trying jsQR fallback...');

        // Fallback to jsQR for QR codes
        try {
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth',
          });

          if (code && code.data) {
            barcodeText = code.data;
            console.log('✅ jsQR detected QR code');
          }
        } catch (jsqrError) {
          console.error('jsQR also failed:', jsqrError);
        }
      }

      // Process the barcode if found
      if (barcodeText) {
        // Try to parse as BCBP
        const bcbpData = parseBCBP(barcodeText);

        if (bcbpData) {
          console.log('✅ Successfully parsed BCBP data:', bcbpData);
          setScanning(false);
          onScanSuccess(bcbpData);
        } else {
          setError('Barcode found, but it\'s not a valid IATA boarding pass format. Make sure you\'re scanning the 2D barcode (not the simple barcode).');
          setScanning(false);
        }
      } else {
        setError('No barcode found in image. Tips:\n• Make sure the barcode is clearly visible\n• Try better lighting\n• Scan the 2D barcode (PDF417/QR code, not the simple 1D barcode)');
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
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold">📸 Scan Boarding Pass</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Instructions */}
        {!preview && (
          <div className="mb-6">
            <p className="text-gray-600 mb-4">
              Upload a photo of your boarding pass barcode. Supports both paper and mobile boarding passes!
            </p>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-semibold mb-2">✅ Supported barcode types:</h3>
              <ul className="text-sm text-gray-700 space-y-1 mb-3">
                <li>📄 <strong>PDF417</strong> - Long rectangular barcode on paper passes</li>
                <li>📱 <strong>QR Code</strong> - Square barcode on mobile passes</li>
                <li>🔷 <strong>Aztec Code</strong> - Some airlines use this format</li>
              </ul>
              <h3 className="font-semibold mb-2">📝 Tips for best results:</h3>
              <ul className="text-sm text-gray-700 space-y-1">
                <li>• Make sure the barcode is clearly visible</li>
                <li>• Use good lighting (avoid shadows)</li>
                <li>• Keep the camera steady</li>
                <li>• Fill the frame with the barcode</li>
                <li>• Scan the 2D barcode (not the simple 1D barcode at top)</li>
              </ul>
            </div>
          </div>
        )}

        {/* Preview */}
        {preview && (
          <div className="mb-4">
            <img src={preview} alt="Boarding pass preview" className="max-w-full h-auto rounded-lg border" />
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="mb-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {/* File input */}
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
            <label
              htmlFor="boarding-pass-upload"
              className="btn-primary w-full cursor-pointer text-center block"
            >
              📷 Take Photo / Upload Image
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

        {/* Hidden canvas for image processing */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Info */}
        <div className="mt-6 text-xs text-gray-500 text-center">
          <p>Your boarding pass data is processed locally and never sent to any server.</p>
        </div>
      </div>
    </div>
  );
}
