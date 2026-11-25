import React from 'react';

/// Petit bouton toolbar — uniformise les ~30 instances ad hoc
/// (px-2 py-1.5 text-xs bg-gray-800 …). `variant` = teinte sémantique.
interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger' | 'success' | 'warning';
  /// Taille — 'sm' pour les rows compactes (px-1.5 py-0.5 text-xs)
  size?: 'md' | 'sm';
  /// Bouton actif/toggled (teinte pleine au lieu de ghost)
  active?: boolean;
}

const BASE: Record<NonNullable<IconButtonProps['variant']>, string> = {
  default: 'bg-gray-800 text-gray-400 hover:text-white',
  primary: 'bg-stagespace-accent/70 text-white hover:bg-stagespace-accent',
  danger: 'bg-stagespace-danger/15 text-red-300 hover:bg-stagespace-danger/25 border border-stagespace-danger/50',
  success: 'bg-stagespace-live/20 text-green-200 hover:bg-stagespace-live/30',
  warning: 'bg-stagespace-warning/20 text-orange-200 hover:bg-stagespace-warning/30',
};

const ACTIVE: Record<NonNullable<IconButtonProps['variant']>, string> = {
  default: 'bg-gray-600 text-white',
  primary: 'bg-stagespace-accent text-white',
  danger: 'bg-stagespace-danger text-white border border-red-500',
  success: 'bg-stagespace-live text-white',
  warning: 'bg-stagespace-warning text-white',
};

export const IconButton: React.FC<IconButtonProps> = ({
  variant = 'default',
  size = 'md',
  active = false,
  className = '',
  ...props
}) => {
  const sizing = size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2.5 py-2.5 text-xs';
  const color = active ? ACTIVE[variant] : BASE[variant];
  return (
    <button
      {...props}
      className={`${sizing} font-medium rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${color} ${className}`}
    />
  );
};

export default IconButton;
