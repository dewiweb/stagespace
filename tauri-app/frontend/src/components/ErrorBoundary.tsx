import React from 'react';
import { toast } from '../utils/toast-helpers';

interface Props {
  children: React.ReactNode;
  /// Nom de la zone pour le message d'erreur (ex: "3D Canvas")
  zone: string;
}

interface State {
  error: Error | null;
}

/// Error boundary par zone : un crash de render dans Scene3D, NodeEditor ou
/// un panneau ne doit PAS démonter l'app entière — la Toolbar (Esc=panic) et
/// les toasts restent hors des boundaries pour garder le contrôle d'urgence.
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.zone}]`, error, info.componentStack);
    toast.error(`${this.props.zone} crashed: ${error.message} — Esc still works (panic)`, 0);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center bg-stagespace-panel text-center p-4">
          <span className="text-red-400 text-sm font-medium">{this.props.zone} crashed</span>
          <span className="text-gray-500 text-xs mt-1 max-w-xs break-words">
            {this.state.error.message}
          </span>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-3 px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
