import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { InputDirective, InputErrorComponent, InputFieldDirective, LabelComponent } from 'src/app/components/input/input.component';
import { ButtonComponent } from 'src/app/components/button/button.component';
import { RadioComponent } from 'src/app/components/radio/radio.component';
import { TooltipComponent } from 'src/app/components/tooltip/tooltip.component';
import { GeneralService } from 'src/app/services/general/general.service';
import { ActivatedRoute, Router } from '@angular/router';
import { CardComponent } from 'src/app/components/card/card.component';
import { CreateEndpointService } from './create-endpoint.service';
import { PrivateService } from '../../private.service';
import { ToggleComponent } from 'src/app/components/toggle/toggle.component';
import { FormLoaderComponent } from 'src/app/components/form-loader/form-loader.component';
import { PermissionDirective } from '../permission/permission.directive';
import { RbacService } from 'src/app/services/rbac/rbac.service';
import { ENDPOINT, SECRET } from 'src/app/models/endpoint.model';
import { EndpointsService } from '../../pages/project/endpoints/endpoints.service';
import { NotificationComponent } from 'src/app/components/notification/notification.component';
import { ConfigButtonComponent } from '../config-button/config-button.component';
import { CopyButtonComponent } from 'src/app/components/copy-button/copy-button.component';
import { LicensesService } from 'src/app/services/licenses/licenses.service';
import { TagComponent } from 'src/app/components/tag/tag.component';

@Component({
	selector: 'convoy-create-endpoint',
	standalone: true,
	imports: [
		CommonModule,
		ReactiveFormsModule,
		InputDirective,
		InputErrorComponent,
		InputFieldDirective,
		LabelComponent,
		ButtonComponent,
		RadioComponent,
		TooltipComponent,
		CardComponent,
		ToggleComponent,
		FormLoaderComponent,
		PermissionDirective,
		NotificationComponent,
		ConfigButtonComponent,
		CopyButtonComponent,
		TagComponent
	],
	templateUrl: './create-endpoint.component.html',
	styleUrls: ['./create-endpoint.component.scss']
})
export class CreateEndpointComponent implements OnInit {
	@Input('editMode') editMode = false;
	@Input('showAction') showAction: 'true' | 'false' = 'false';
	@Input('type') type: 'in-app' | 'portal' | 'subscription' = 'in-app';
	@Output() onAction = new EventEmitter<any>();
	savingEndpoint = false;
	isLoadingEndpointDetails = false;
	isLoadingEndpoints = false;
	addNewEndpointForm: FormGroup = this.formBuilder.group({
		name: ['', Validators.required],
		url: ['', Validators.compose([Validators.required, Validators.pattern(`^(?:https?|ftp)://[a-zA-Z0-9-]+(?:.[a-zA-Z0-9-]+)+(?::[0-9]+)?/?(?:[a-zA-Z0-9-_.~!$&'()*+,;=:@/?#%]*)?$`)])],
		support_email: ['', Validators.email],
		slack_webhook_url: ['', Validators.pattern(`^(?:https?|ftp)://[a-zA-Z0-9-]+(?:.[a-zA-Z0-9-]+)+(?::[0-9]+)?/?(?:[a-zA-Z0-9-_.~!$&'()*+,;=:@/?#%]*)?$`)],
		secret: [null],
		http_timeout: [null, Validators.pattern('^[-+]?[0-9]+$')],
		description: [null],
		owner_id: [null],
		rate_limit: [null],
		rate_limit_duration: [null],
		authentication: this.formBuilder.group({
			type: ['api_key'],
			api_key: this.formBuilder.group({
				header_name: [''],
				header_value: ['']
			})
		}),
		advanced_signatures: [null]
	});
	token: string = this.route.snapshot.params.token;
	@Input('endpointId') endpointUid = this.route.snapshot.params.id;
	enableMoreConfig = false;
	configurations = [{ uid: 'http_timeout', name: 'Timeout ', show: false, deleted: false }];
	endpointCreated: boolean = false;
	endpointSecret?: SECRET;
	currentRoute = window.location.pathname.split('/').reverse()[0];
	private rbacService = inject(RbacService);

	constructor(
		private formBuilder: FormBuilder,
		private generalService: GeneralService,
		private createEndpointService: CreateEndpointService,
		private route: ActivatedRoute,
		public privateService: PrivateService,
		private router: Router,
		private endpointService: EndpointsService,
		public licenseService: LicensesService
	) {}

	async ngOnInit() {
		if (this.type !== 'portal')
			this.configurations.push(
				{ uid: 'owner_id', name: 'Owner ID ', show: false, deleted: false },
				{ uid: 'rate_limit', name: 'Rate Limit ', show: false, deleted: false },
				{ uid: 'auth', name: 'Auth', show: false, deleted: false },
				{ uid: 'alert_config', name: 'Notifications', show: false, deleted: false },
				{ uid: 'signature', name: 'Signature Format', show: false, deleted: false },
			);

		if (!this.endpointUid) this.endpointUid = this.route.snapshot.params.id;
		if ((this.isUpdateAction || this.editMode) && this.type !== 'subscription') this.getEndpointDetails();
		if (!(await this.rbacService.userCanAccess('Endpoints|MANAGE'))) this.addNewEndpointForm.disable();
	}

	async runEndpointValidation() {
		const configFields: any = {
			http_timeout: ['http_timeout'],
			signature: ['advanced_signatures'],
			rate_limit: ['rate_limit', 'rate_limit_duration'],
			alert_config: ['support_email', 'slack_webhook_url'],
			auth: ['authentication.api_key.header_name', 'authentication.api_key.header_value']
		};
		this.configurations.forEach(config => {
			const fields = configFields[config.uid];
			if (this.showConfig(config.uid)) {
				fields?.forEach((item: string) => {
					this.addNewEndpointForm.get(item)?.addValidators(Validators.required);
					this.addNewEndpointForm.get(item)?.updateValueAndValidity();
				});
			} else {
				fields?.forEach((item: string) => {
					this.addNewEndpointForm.get(item)?.removeValidators(Validators.required);
					this.addNewEndpointForm.get(item)?.updateValueAndValidity();
				});
			}
		});
		return;
	}

	async saveEndpoint() {
		await this.runEndpointValidation();

		if (this.addNewEndpointForm.invalid) {
			this.savingEndpoint = false;
			return this.addNewEndpointForm.markAllAsTouched();
		}


        let rateLimitDeleted = !this.showConfig('rate_limit') && this.configDeleted('rate_limit');
        if (rateLimitDeleted) {
            const configKeys = ['rate_limit', 'rate_limit_duration'];
            configKeys.forEach((key) => {
                this.addNewEndpointForm.value[key] = 0; // element type = number
                this.addNewEndpointForm.get(`${key}`)?.patchValue(0);
            });
            this.setConfigFormDeleted('rate_limit', false);
        }


		this.savingEndpoint = true;
		const endpointValue = structuredClone(this.addNewEndpointForm.value);

		if (!this.addNewEndpointForm.value.authentication.api_key.header_name && !this.addNewEndpointForm.value.authentication.api_key.header_value) delete endpointValue.authentication;

		try {
			const response =
				(this.isUpdateAction || this.editMode) && this.type !== 'subscription' ? await this.createEndpointService.editEndpoint({ endpointId: this.endpointUid || '', body: endpointValue }) : await this.createEndpointService.addNewEndpoint({ body: endpointValue });
			this.generalService.showNotification({ message: response.message, style: 'success' });
			this.onAction.emit({ action: this.endpointUid && this.editMode ? 'update' : 'save', data: response.data });
			this.addNewEndpointForm.reset();
			this.endpointCreated = true;
			return response;
		} catch {
			this.endpointCreated = false;
			this.savingEndpoint = false;
			return;
		}
	}

	async getEndpointDetails() {
		this.isLoadingEndpointDetails = true;

		try {
			const response = await this.endpointService.getEndpoint(this.endpointUid);
			const endpointDetails: ENDPOINT = response.data;

			this.endpointSecret = endpointDetails?.secrets?.find(secret => !secret.expires_at);
			if (endpointDetails.rate_limit_duration) this.toggleConfigForm('rate_limit');
			this.addNewEndpointForm.patchValue(endpointDetails);

			if (endpointDetails.owner_id) this.toggleConfigForm('owner_id');

			if (endpointDetails.support_email) this.toggleConfigForm('alert_config');
			if (endpointDetails.authentication.api_key.header_value || endpointDetails.authentication.api_key.header_name) this.toggleConfigForm('auth');
			if (endpointDetails.http_timeout) this.toggleConfigForm('http_timeout');

			this.isLoadingEndpointDetails = false;
		} catch {
			this.isLoadingEndpointDetails = false;
		}
	}

	async getEndpoints() {
		this.isLoadingEndpoints = true;
		try {
			const response = await this.privateService.getEndpoints();
			const endpoints = response.data.content;
			if (endpoints.length > 0 && this.router.url.includes('/configure')) this.onAction.emit({ action: 'save' });
			this.isLoadingEndpoints = false;
		} catch {
			this.isLoadingEndpoints = false;
		}
	}

	getDurationInSeconds(timeString: string) {
		const timeParts = timeString.split('m');
		let minutes = 0;
		let seconds = 0;

		if (timeParts.length > 0) {
			minutes = parseInt(timeParts[0], 10);
		}

		if (timeParts.length > 1) {
			seconds = parseInt(timeParts[1].replace('s', ''), 10);
		}
		const totalSeconds = minutes * 60 + seconds;

		return totalSeconds;
	}

	toggleConfigForm(configValue: string, deleted?: boolean) {
		this.configurations.forEach(config => {
			if (config.uid === configValue) {
                config.show = !config.show;
                config.deleted = deleted ?? false;
            }
		});
	}

    setConfigFormDeleted(configValue: string, deleted: boolean) {
        this.configurations.forEach(config => {
            if (config.uid === configValue) {
                config.deleted = deleted;
            }
        });
    }

	showConfig(configValue: string): boolean {
		return this.configurations.find(config => config.uid === configValue)?.show || false;
	}

    configDeleted(configValue: string): boolean {
        return this.configurations.find(config => config.uid === configValue)?.deleted || false;
    }

	get shouldShowBorder(): number {
		return this.configurations.filter(config => config.show).length;
	}

	get isUpdateAction(): boolean {
		return this.endpointUid && this.endpointUid !== 'new' && this.currentRoute !== 'setup';
	}
}
