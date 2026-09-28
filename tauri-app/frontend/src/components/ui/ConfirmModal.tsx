import React from 'react';
import { Modal } from './Modal';

/// Confirmation modal for destructive actions (delete cue/slot).
/// Focus lands on Cancel (first focusable) so a stray Enter cancels —
/// safe default for destructive ops. Esc/click-outside = cancel.
interface ConfirmModalProps {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
}) => (
  <Modal title={title} onClose={onCancel} widthClass="max-w-sm">
    <div className="p-4">
      <div className="text-gray-300 text-[11px] leading-relaxed">{message}</div>
      <div className="flex gap-2 mt-4">
        <button
          onClick={onCancel}
          className="flex-1 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-[11px] rounded font-medium"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="flex-1 py-1.5 bg-red-700 hover:bg-red-600 text-white text-[11px] rounded font-bold"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </Modal>
);

export default ConfirmModal;
