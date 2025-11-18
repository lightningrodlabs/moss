import {
  downloadHolochainBinary,
  downloadLairBinary,
  downloadBootstrapBinary,
  downloadHcBinary
} from './fetch-fns.mjs';

downloadHolochainBinary();
downloadLairBinary();
downloadBootstrapBinary();
downloadHcBinary(true);
