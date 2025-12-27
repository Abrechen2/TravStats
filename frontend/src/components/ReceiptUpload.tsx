import { useState, useRef } from 'react';
import { uploadsApi, API_URL } from '../lib/api';
import { useTranslation } from '../hooks/useTranslation';

interface ReceiptUploadProps {
  currentReceiptUrl?: string | null;
  onUploadSuccess: (receiptUrl: string) => void;
  onDelete: () => void;
}

export default function ReceiptUpload({
  currentReceiptUrl,
  onUploadSuccess,
  onDelete,
}: ReceiptUploadProps) {
  const { t } = useTranslation(['flights', 'common', 'errors']);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (file: File) => {
    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      setError(t('flights:receipt.invalidFileType'));
      return;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      setError(t('flights:receipt.fileTooLarge'));
      return;
    }

    setError('');
    setUploading(true);
    setUploadProgress(0);

    try {
      const receiptUrl = await uploadsApi.uploadReceipt(file, setUploadProgress);
      onUploadSuccess(receiptUrl);
      setUploadProgress(0);
    } catch (err: any) {
      setError(err.response?.data?.error || t('flights:receipt.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleDelete = () => {
    if (confirm(t('flights:receipt.deleteConfirm'))) {
      onDelete();
    }
  };

  return (
    <div className="space-y-3">
      <label className="label">{t('flights:receipt.label')}</label>

      {currentReceiptUrl && !uploading ? (
        <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <div className="flex-1">
            <a
              href={currentReceiptUrl.startsWith('http') ? currentReceiptUrl : `${API_URL || window.location.origin}${currentReceiptUrl}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline text-sm"
            >
              {t('flights:receipt.viewReceipt')}
            </a>
          </div>
          <button
            type="button"
            onClick={handleDelete}
            className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-sm"
          >
            {t('common:buttons.remove')}
          </button>
        </div>
      ) : (
        <div
          className={`relative border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            dragActive
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/gif,image/webp,application/pdf"
            onChange={(e) => e.target.files && handleFileChange(e.target.files[0])}
            className="hidden"
            disabled={uploading}
          />

          {uploading ? (
            <div className="space-y-2">
              <p className="text-sm text-gray-600 dark:text-gray-400">{t('flights:receipt.uploading', { progress: uploadProgress })}</p>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          ) : (
            <>
              <svg
                className="mx-auto h-12 w-12 text-gray-400"
                stroke="currentColor"
                fill="none"
                viewBox="0 0 48 48"
              >
                <path
                  d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
                >
                  {t('flights:receipt.uploadFile')}
                </button>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{t('flights:receipt.dragAndDrop')}</p>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
                {t('flights:receipt.fileFormats')}
              </p>
            </>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
