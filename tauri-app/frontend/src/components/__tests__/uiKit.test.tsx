/// <reference types="vitest/globals" />

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Slider from '../ui/Slider';
import Modal from '../ui/Modal';
import IconButton from '../ui/IconButton';
import { closeTopModal, isModalOpen } from '../../utils/modalGuard';

describe('ui/Slider', () => {
  it('renders label + formatted value and forwards changes (row)', () => {
    const onChange = vi.fn();
    render(
      <Slider label="Speed" value={1.5} min={0} max={4} step={0.1} onChange={onChange} unit="x" />,
    );
    expect(screen.getByText('Speed')).toBeInTheDocument();
    expect(screen.getByText('1.5x')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('slider'), { target: { value: '2.5' } });
    expect(onChange).toHaveBeenCalledWith(2.5);
  });

  it('renders stack layout with live styling', () => {
    render(
      <Slider layout="stack" label="Yaw" value={90} min={-180} max={180} step={5}
        onChange={() => {}} unit="°" live decimals={0} />,
    );
    expect(screen.getByText('90°')).toBeInTheDocument();
  });

  it('renders bare layout without label/value chrome', () => {
    const { container } = render(
      <Slider layout="bare" value={0.5} min={0} max={1} step={0.05} onChange={() => {}} />,
    );
    expect(container.querySelector('input[type="range"]')).toBeInTheDocument();
    expect(container.textContent).toBe('');
  });
});

describe('ui/Modal', () => {
  it('registers in modalGuard stack and Esc-equivalent closes it', () => {
    const onClose = vi.fn();
    const { unmount } = render(<Modal title="Test" onClose={onClose}>content</Modal>);
    expect(isModalOpen()).toBe(true);
    expect(closeTopModal()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(isModalOpen()).toBe(false);
  });

  it('overlay click calls onClose', () => {
    const onClose = vi.fn();
    const { container } = render(<Modal onClose={onClose}>content</Modal>);
    fireEvent.click(container.firstChild as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });

  it('overlay click does not close when closeOnOverlay=false', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal onClose={onClose} closeOnOverlay={false}>content</Modal>,
    );
    fireEvent.click(container.firstChild as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('ui/IconButton', () => {
  it('renders and forwards click', () => {
    const onClick = vi.fn();
    render(<IconButton onClick={onClick} title="panic">⏹</IconButton>);
    fireEvent.click(screen.getByTitle('panic'));
    expect(onClick).toHaveBeenCalled();
  });
});
