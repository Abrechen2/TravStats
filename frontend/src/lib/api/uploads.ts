import { api } from "./client";

// Upload API
export const uploadsApi = {
  uploadReceipt: async (file: File, onProgress?: (progress: number) => void): Promise<string> => {
    const formData = new FormData();
    formData.append("receipt", file);

    const { data } = await api.post<{
      receiptUrl: string;
      filename: string;
      size: number;
      mimetype: string;
    }>("/uploads/receipt", formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(progress);
        }
      },
    });

    return data.receiptUrl;
  },

  deleteReceipt: async (filename: string): Promise<void> => {
    await api.delete(`/uploads/receipts/${filename}`);
  },
};
