import { Controller } from '@nestjs/common';
import { HostsService } from './hosts.service';

@Controller('hosts')
export class HostsController {
  constructor(private readonly hostsService: HostsService) {}
}
