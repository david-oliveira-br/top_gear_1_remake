import { NIAGARA, NIAGARA_BRIDGE } from '../src/index';
import { regionTests } from './region';

regionTests('niagara (Niagara Parkway)', NIAGARA, { len: [6000, 6600], y: [90, 185], flats: [NIAGARA_BRIDGE], trial: 'niagara-trial', run: 'niagara-run', minWeather: ['fog', 'rain', 'storm'], hw: 6.5 });
