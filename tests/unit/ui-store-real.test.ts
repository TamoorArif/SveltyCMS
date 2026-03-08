import { describe, expect, it } from 'bun:test';
import { ui } from '../../src/stores/ui-store.svelte';

describe('UIStore (Real)', () => {
	it('should have initial state', () => {
		expect(ui.state.leftSidebar).toBe('full');
	});

	it('should toggle UI element visibility', () => {
		ui.toggle('leftSidebar', 'hidden');
		expect(ui.state.leftSidebar).toBe('hidden');
	});

	it('should be a singleton', () => {
		const { ui: ui2 } = require('../../src/stores/ui-store.svelte');
		expect(ui).toBe(ui2);
	});
});
