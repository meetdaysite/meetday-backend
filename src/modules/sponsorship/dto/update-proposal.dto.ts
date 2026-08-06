import { CreateProposalDto } from './create-proposal.dto';

// Identical shape to CreateProposalDto (all fields optional) — kept as a distinct type so
// PATCH request bodies are documented separately from POST in Swagger.
export class UpdateProposalDto extends CreateProposalDto {}
