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
  primary: 'bg-indigo-800 text-indigo-200 hover:bg-indigo-700',
  danger: 'bg-red-900/60 text-red-300 hover:bg-red-800 border border-red-700/50',
  success: 'bg-green-800 text-green-200 hover:bg-green-700',
  warning: 'bg-orange-800/70 text-orange-200 hover:bg-orange-700',
};

const ACTIVE: Record<NonNullable<IconButtonProps['variant']>, string> = {
  default: 'bg-gray-600 text-white',
  primary: 'bg-indigo-600 text-white',
  danger: 'bg-red-700 text-white border border-red-500',
  success: 'bg-green-600 text-white',
  warning: 'bg-orange-600 text-white',
};

export const IconButton: React.FC<IconButtonProps> = ({
  variant = 'default',
  size = 'md',
  active = false,
  className = '',
  ...props
}) => {
  const sizing = size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1.5 text-xs';
  const color = active ? ACTIVE[variant] : BASE[variant];
  return (
    <button
      {...props}
      className={`${sizing} font-medium rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${color} ${className}`}
    />
  );
};

export default IconButton;
