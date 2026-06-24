// Identify the fuel vendor from an email's sender (primary) or attachment filename.
export const vendorFor = ({ from = '', filename = '' } = {}) => {
  const f = `${from}`.toLowerCase();
  if (f.includes('everest-fuel.com')) return 'everest';
  if (f.includes('wfscorp.com')) return 'wfs';
  const n = `${filename}`.toLowerCase();
  if (n.includes('everest')) return 'everest';
  if (n.includes('wfs')) return 'wfs';
  return null;
};
