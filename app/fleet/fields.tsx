import { randomUUID } from 'node:crypto'
import FleetForm from './FleetForm'
import { serviceStates, vehicleStates, type Option, type Service, type Trip, type Vehicle } from '@/lib/fleet/domain'
import styles from './fleet.module.css'

export function VehicleForm({ companyId, drivers, vehicle }: { companyId: string; drivers: Option[]; vehicle?: Vehicle }) {
  return <FleetForm key={vehicle?.version ?? 'new'} companyId={companyId} requestId={randomUUID()} operation="vehicle.save" openCreated={!vehicle} label={vehicle ? 'Uložit vozidlo' : 'Přidat vozidlo'}>
    <input type="hidden" name="id" defaultValue={vehicle?.id ?? ''} /><input type="hidden" name="version" defaultValue={vehicle?.version ?? ''} />
    <div className={styles.grid}><label>Název vozidla<input name="name" required maxLength={120} defaultValue={vehicle?.name} placeholder="Např. Škoda Octavia" /></label><label>Registrační značka<input name="plate" required maxLength={24} defaultValue={vehicle?.plate} placeholder="1AB 2345" /></label></div>
    <div className={styles.grid}><label>Stav<select name="status" defaultValue={vehicle?.status ?? 'active'}>{Object.entries(vehicleStates).map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label><label>Přiřazený řidič<select name="driver_id" defaultValue={vehicle?.driver_id ?? ''}><option value="">Bez přiřazení</option>{drivers.map(driver => <option value={driver.id} key={driver.id}>{driver.name}</option>)}</select></label></div>
    <label>Počáteční stav tachometru (km)<input name="initial_odometer" required type="number" min="0" max="99999999" step="0.1" defaultValue={vehicle?.initial_odometer ?? 0} /></label>
    <details className={styles.disclosure} open={!vehicle}><summary>Metoda nákladů a poznámka</summary><div className={styles.grid}><label>Jak započítávat náklady do zakázek<select name="cost_method" defaultValue={vehicle?.cost_method ?? 'actual'}><option value="actual">Skutečné náklady, ruční rozdělení</option><option value="mileage">Sazba za kilometr včetně provozu</option></select></label><label>Sazba za kilometr (Kč)<input name="km_rate" type="number" required min="0" max="10000" step="0.01" defaultValue={vehicle?.km_rate ?? 0} /></label></div><p className={styles.hint}>Kilometrová sazba zahrnuje palivo i další provoz. Tankování pak evidujete pouze pro přehled; znovu se nezapočítá do zakázky. Metodu a počáteční tachometr lze změnit jen před prvním záznamem.</p><label>Poznámka<textarea name="notes" maxLength={4000} defaultValue={vehicle?.notes} /></label></details>
    <p className={styles.hint}>Aktivní auta a auta v servisu se započítávají do kapacity. Archiv zachová všechny doklady a jízdy.</p>
  </FleetForm>
}

function localDateTime(value?: string) {
  if (!value) return ''
  // Inputs carry Prague local wall time; browser submit serializes the user's timezone explicitly.
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  return parts.replace(' ', 'T')
}

export function TripForm({ companyId, vehicle, drivers, jobs, actorId, manager, trip }: { companyId: string; vehicle: Vehicle; drivers: Option[]; jobs: Option[]; actorId: string; manager: boolean; trip?: Trip }) {
  return <FleetForm key={trip?.version ?? 'new'} companyId={companyId} vehicleId={vehicle.id} requestId={randomUUID()} operation="trip.save" label={trip ? 'Uložit úpravu jízdy' : 'Uložit koncept jízdy'}>
    <input type="hidden" name="id" defaultValue={trip?.id ?? ''} /><input type="hidden" name="version" defaultValue={trip?.version ?? ''} />
    {manager ? <label>Řidič<select name="driver_id" defaultValue={trip?.driver_id ?? vehicle.driver_id ?? actorId} required><option value="">Vyberte řidiče</option>{drivers.map(driver => <option value={driver.id} key={driver.id}>{driver.name}</option>)}</select></label> : <input type="hidden" name="driver_id" value={actorId} />}
    <div className={styles.grid}><label>Odjezd (místní čas prohlížeče)<input type="datetime-local" name="started_at" required defaultValue={localDateTime(trip?.started_at)} /></label><label>Příjezd<input type="datetime-local" name="ended_at" required defaultValue={localDateTime(trip?.ended_at)} /></label></div>
    <div className={styles.grid}><label>Odkud<input name="origin" required maxLength={200} defaultValue={trip?.origin} placeholder="Místo odjezdu" /></label><label>Kam<input name="destination" required maxLength={200} defaultValue={trip?.destination} placeholder="Cíl jízdy" /></label></div>
    <label>Účel jízdy<input name="purpose" required maxLength={1000} defaultValue={trip?.purpose} placeholder="Např. doprava na zakázku" /></label>
    <div className={styles.grid}><label>Tachometr před jízdou (km)<input name="odometer_start" type="number" min="0" step="0.1" required defaultValue={trip?.odometer_start} /></label><label>Tachometr po jízdě (km)<input name="odometer_end" type="number" min="0" step="0.1" required defaultValue={trip?.odometer_end} /></label></div>
    <label>Zakázka (volitelné)<select name="job_id" defaultValue={trip?.job_id ?? ''}><option value="">Bez vazby na zakázku</option>{jobs.map(job => <option key={job.id} value={job.id}>{job.name}</option>)}</select></label>
    <p className={styles.hint}>Tachometr musí přesně navazovat na předchozí jízdu; první začíná na {vehicle.initial_odometer} km. Překryvy času vozidla i řidiče se kontrolují při uložení.</p>
  </FleetForm>
}

export function ServiceForm({ companyId, vehicleId, service }: { companyId: string; vehicleId: string; service?: Service }) {
  return <FleetForm key={service?.version ?? 'new'} companyId={companyId} vehicleId={vehicleId} operation="service.save" requestId={randomUUID()} label={service ? 'Uložit servis' : 'Naplánovat servis'}>
    <input type="hidden" name="id" defaultValue={service?.id ?? ''} /><input type="hidden" name="version" defaultValue={service?.version ?? ''} />
    <label>Úkol nebo termín<input name="title" required maxLength={200} defaultValue={service?.title} placeholder="Např. výměna oleje, STK" /></label>
    <div className={styles.grid}><label>Termín<input name="due_on" type="date" required defaultValue={service?.due_on} /></label><label>Stav<select name="status" defaultValue={service?.status ?? 'planned'}>{Object.entries(serviceStates).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
    <label>Poznámka<textarea name="notes" maxLength={4000} defaultValue={service?.notes} /></label>
  </FleetForm>
}
