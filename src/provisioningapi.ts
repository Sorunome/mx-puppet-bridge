/*
Copyright 2019, 2020 mx-puppet-bridge
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { PuppetBridge } from "./puppetbridge";
import { Router, Request, Response } from "express";
import { IPuppet } from "./db/puppetstore";

const OK = 200;
const CREATED = 201;
const NO_CONTENT = 204;
const BAD_REQUEST = 400;
const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const NOT_IMPLEMENTED = 501;

export interface IPuppetWithDescription extends IPuppet {
	description: string | null;
}

export class ProvisioningAPI {
	private readonly apiRouterV1: Router;
	private readonly apiSharedSecret: string;
	constructor(
		private readonly bridge: PuppetBridge,
	) {
		this.apiRouterV1 = Router();
		this.apiSharedSecret = bridge.config.provisioning.sharedSecret;

		const apiRouter = Router();
		bridge.AS.expressAppInstance.use(bridge.config.provisioning.apiPrefix, apiRouter);
		apiRouter.use(this.checkProvisioningSharedSecret);
		apiRouter.use("/v1", this.apiRouterV1);

		this.apiRouterV1.get("/status", this.status);
		this.apiRouterV1.post("/link", this.link);
		this.apiRouterV1.post("/:puppetId(\d+)/unlink", this.unlink);
		this.apiRouterV1.get("/:puppetId(\d+)/users", this.listUsers);
		this.apiRouterV1.get("/:puppetId(\d+)/rooms", this.listRooms);
	}

	get v1(): Router {
		return this.apiRouterV1;
	}

	private async checkProvisioningSharedSecret(req: Request, res: Response, next: () => void) {
		if (!this.apiSharedSecret) {
			res.status(FORBIDDEN).json({
				error: "The provisioning API is disabled",
				errcode: "M_FORBIDDEN",
			});
		} else if (req.header("Authorization") !== `Bearer ${this.apiSharedSecret}`) {
			res.status(UNAUTHORIZED).json({
				error: "Unknown or missing token",
				errcode: "M_UNKNOWN_TOKEN",
			});
		} else if (!req.query.user_id) {
			res.status(BAD_REQUEST).json({
				error: "Missing user_id query parameter",
				errcode: "M_BAD_REQUEST",
			});
		} else {
			next();
		}
	}

	private async status(req: Request, res: Response) {
		const puppets = await this.bridge.provisioner.getForMxid(req.query.user_id) as IPuppetWithDescription[];
		if (this.bridge.hooks.getDesc) {
			for (const data of puppets) {
				data.description = await this.bridge.hooks.getDesc(data.puppetId, data.data);
			}
		}
		res.json({
			puppets,
			permissions: {
				create: this.bridge.provisioner.canCreate(req.query.user_id),
				relay: this.bridge.provisioner.canRelay(req.query.user_id),
			},
		});
	}

	private async link(req: Request, res: Response) {
		const puppetId = await this.bridge.provisioner.new(req.query.user_id, req.body.data, req.body.remote_user_id);
		res.status(CREATED).json({ puppet_id: puppetId });
	}

	private async getPuppetId(req: Request, res: Response): Promise<number | null> {
		const puppetId = Number(req.params.puppetId);
		const data = await this.bridge.provisioner.get(puppetId);
		if (!data || data.puppetMxid !== req.query.user_id) {
			res.status(FORBIDDEN).json({
				error: "You must own the puppet ID",
				errcode: "M_FORBIDDEN",
			});
			return null;
		}
		return puppetId;
	}

	private async unlink(req: Request, res: Response) {
		const puppetId = await this.getPuppetId(req, res);
		if (!puppetId) {
			return;
		}
		await this.bridge.provisioner.delete(req.query.user_id, puppetId);
		res.status(NO_CONTENT);
	}

	private async listUsers(req: Request, res: Response) {
		if (!this.bridge.hooks.listUsers) {
			res.status(NOT_IMPLEMENTED).json({
				error: "listUsers hook not implemented",
				errcode: "M_NOT_IMPLEMENTED",
			});
			return;
		}
		const puppetId = await this.getPuppetId(req, res);
		if (!puppetId) {
			return;
		}
		res.status(OK).json(await this.bridge.hooks.listUsers(puppetId));
	}

	private async listRooms(req: Request, res: Response) {
		if (!this.bridge.hooks.listRooms) {
			res.status(NOT_IMPLEMENTED).json({
				error: "listUsers hook not implemented",
				errcode: "M_NOT_IMPLEMENTED",
			});
			return;
		}
		const puppetId = await this.getPuppetId(req, res);
		if (!puppetId) {
			return;
		}
		res.status(OK).json(await this.bridge.hooks.listRooms(+req.params.puppetId));
	}
}
