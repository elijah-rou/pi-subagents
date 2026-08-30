type FleetInvalidationListener = () => void;

const listeners = new Set<FleetInvalidationListener>();

/** Notify live Fleet surfaces after observable Fleet state changes. */
export function invalidateFleetViews(): void {
	for (const listener of [...listeners]) listener();
}

export function subscribeFleetInvalidation(listener: FleetInvalidationListener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
