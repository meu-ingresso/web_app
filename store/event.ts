import { Module, VuexModule, Mutation, Action } from 'vuex-module-decorators';
import { $axios } from '@/utils/nuxt-instance';
import { SearchPayload } from '~/models';
import { formatRealValue } from '~/utils/formatters';
import { category } from '~/utils/store-util';

async function getStatusByModuleName(module, name) {
  const response = await $axios.$get(
    `statuses?where[module][v]=${module}&where[name][v]=${name}`
  );

  if (!response.body || response.body.code !== 'SEARCH_SUCCESS') {
    throw new Error(`Falha ao buscar status do módulo: ${module}.`);
  }

  return response.body.result.data[0];
}

async function createAddress(eventPayload) {
  const addressResponse = await $axios.$post('address', {
    street: eventPayload.address.street,
    zipcode: eventPayload.address.zipcode,
    number: eventPayload.address.number,
    complement: eventPayload.address.complement || '',
    neighborhood: eventPayload.address.neighborhood,
    latitude: eventPayload.address.latitude || null,
    longitude: eventPayload.address.longitude || null,
    city: eventPayload.address.city,
    state: eventPayload.address.state,
  });

  if (!addressResponse.body || addressResponse.body.code !== 'CREATE_SUCCESS') {
    throw new Error('Failed to create address.');
  }

  return addressResponse.body.result.id;
}

async function createEvent(eventPayload, addressId) {
  // Busca o status de evento rascunho
  const statusResponse = await getStatusByModuleName('event', 'Rascunho');

  const eventResponse = await $axios.$post('event', {
    alias: eventPayload.alias,
    name: eventPayload.eventName,
    description: eventPayload.general_information,
    status_id: statusResponse.id,
    address_id: addressId,
    category_id: eventPayload.category.value,
    rating_id: eventPayload.rating.value,
    start_date: `${eventPayload.startDate}T${eventPayload.startTime}:00.000Z`,
    end_date: `${eventPayload.endDate}T${eventPayload.endTime}:00.000Z`,
    general_information: eventPayload.general_information,
    location_name: eventPayload.address.location_name,
    availability: eventPayload.availability,
    sale_type: eventPayload.sale_type,
    event_type: eventPayload.event_type,
    promoter_id: eventPayload.promoter_id || '',
    is_featured: eventPayload.is_featured,
    absorb_service_fee: eventPayload.absorb_service_fee || false,
  });

  if (!eventResponse.body || eventResponse.body.code !== 'CREATE_SUCCESS') {
    throw new Error('Failed to create event.');
  }

  return eventResponse.body.result.id;
}

async function createEventBanner(eventId) {
  const attachmentResponse = await $axios.$post('event-attachment', {
    event_id: eventId,
    name: 'banner',
    type: 'image',
    url: '',
  });

  if (!attachmentResponse.body || attachmentResponse.body.code !== 'CREATE_SUCCESS') {
    throw new Error('Failed to create attachment.');
  }

  return attachmentResponse.body.result.id;
}

async function updateEventBanner(attachmentId, bannerUrl) {
  const updateResponse = await $axios.$patch('event-attachment', {
    id: attachmentId,
    image_url: bannerUrl,
  });

  if (!updateResponse.body || updateResponse.body.code !== 'UPDATE_SUCCESS') {
    throw new Error('Failed to update banner.');
  }
}

async function uploadEventBanner(attachmentId, banner) {
  const formData = new FormData();
  formData.append('event_attachment_id', attachmentId);
  formData.append('file', banner);

  const uploadResponse = await $axios.$post('upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  if (!uploadResponse.body || uploadResponse.body.code !== 'CREATE_SUCCESS') {
    throw new Error('Failed to upload banner.');
  }

  return uploadResponse.body.result.s3_url;
}

async function createTicketsAndCategories(eventId, tickets) {
  const ticketMap = {}; // Mapeia nome do ingresso -> ID
  const categoryMap = new Map();

  // Busca o status de ingresso disponível
  const statusResponse = await getStatusByModuleName('ticket', 'Disponível');

  const ticketPromises = tickets.map(async (ticket, index) => {
    let categoryId = null;

    // Se houver categoria, cria
    if (ticket.category !== '') {
      categoryId = categoryMap.get(ticket.category);

      if (!categoryId) {
        const categoryResponse = await $axios.$post('ticket-event-category', {
          event_id: eventId,
          name: ticket.category,
        });

        if (!categoryResponse.body || categoryResponse.body.code !== 'CREATE_SUCCESS') {
          throw new Error('Failed to create ticket-event-category.');
        }

        categoryId = categoryResponse.body.result.id;
        categoryMap.set(ticket.category, categoryId);
      }
    }

    const ticketPrice = parseFloat(ticket.price.replace(',', '.'));

    // Cria ingresso condicionando se envia a categoria ou não
    const payload: any = {
      event_id: eventId,
      name: ticket.name,
      total_quantity: ticket.max_quantity,
      remaining_quantity: ticket.max_quantity,
      price: ticketPrice,
      status_id: statusResponse.id,
      start_date: `${ticket.open_date}T${ticket.start_time}:00.000Z`,
      end_date: `${ticket.close_date}T${ticket.end_time}:00.000Z`,
      availability: ticket.availability.value,
      display_order: index + 1,
      min_quantity_per_user: ticket.min_purchase,
      max_quantity_per_user: ticket.max_purchase,
    };

    if (categoryId) {
      payload.ticket_event_category_id = categoryId;
    }

    const ticketResponse = await $axios.$post('ticket', payload);

    if (!ticketResponse.body || ticketResponse.body.code !== 'CREATE_SUCCESS') {
      throw new Error('Failed to create ticket.');
    }

    ticketMap[ticket.name] = ticketResponse.body.result.id;
  });

  await Promise.all(ticketPromises);

  return ticketMap;
}

async function createCustomFields(eventId, customFields) {
  const fieldTicketMap = {}; // Mapeia campo -> ingressos

  try {
    for (const [index, customField] of customFields.entries()) {
      for (const personType of customField.personTypes) {
        const isRequired = customField.options.some(
          (option) => option.value === 'required'
        );
        const visibleOnTicket = customField.options.some(
          (option) => option.value === 'visible_on_ticket'
        );
        const isUnique = customField.options.some(
          (option) => option.value === 'is_unique'
        );

        const fieldResponse = await $axios.$post('event-checkout-field', {
          event_id: eventId,
          name: customField.name,
          type: customField.type.value,
          person_type: personType.value,
          required: isRequired,
          is_unique: isUnique,
          visible_on_ticket: visibleOnTicket,
          help_text: customField.help_text || '',
          order: customField.order || index + 1,
        });

        if (!fieldResponse.body || fieldResponse.body.code !== 'CREATE_SUCCESS') {
          throw new Error('Failed to event checkout field.');
        }

        const fieldId = fieldResponse.body.result.id;

        // Relaciona o campo aos ingressos especificados
        customField.tickets.forEach((ticketName) => {
          if (!fieldTicketMap[ticketName]) {
            fieldTicketMap[ticketName] = [];
          }
          fieldTicketMap[ticketName].push(fieldId);
        });
      }
    }

    return fieldTicketMap; // Retorna o mapeamento dos campos para os ingressos
  } catch (error) {
    console.error('Error in createCustomFields:', error);
    throw new Error('Failed to create custom fields.');
  }
}

async function createEventCheckoutFieldTicketRelations(fieldTicketMap, ticketMap) {
  try {
    const relationsPromises = [];

    for (const [ticketName, fieldIds] of Object.entries(fieldTicketMap)) {
      const ticketId = ticketMap[ticketName];

      (fieldIds as any[]).forEach((fieldId) => {
        relationsPromises.push(
          $axios.$post('event-checkout-field-ticket', {
            event_checkout_field_id: fieldId,
            ticket_id: ticketId,
          })
        );
      });
    }

    await Promise.all(relationsPromises);
  } catch (error) {
    console.error('Error in createEventCheckoutFieldTicketRelations:', error);
    throw new Error('Failed to create event-checkout-field-ticket relations.');
  }
}

async function createCouponTicketRelations(couponTicketMap, ticketMap) {
  try {
    const relationsPromises = [];

    for (const [ticketName, couponIds] of Object.entries(couponTicketMap)) {
      const ticketId = ticketMap[ticketName];

      (couponIds as any[]).forEach((couponId) => {
        relationsPromises.push(
          $axios.$post('coupon-ticket', {
            coupon_id: couponId,
            ticket_id: ticketId,
          })
        );
      });
    }

    await Promise.all(relationsPromises);
  } catch (error) {
    console.error('Error in createCouponTicketRelations:', error);
    throw new Error('Failed to create coupon-ticket relations.');
  }
}

async function createCouponsWithTickets(eventId, coupons, statusId) {
  const couponTicketMap = {}; // Mapeia cupom -> ingressos

  const couponPromises = coupons.map(async (coupon) => {
    const couponDiscountValue = parseFloat(coupon.discountValue.replace(',', '.'));

    const couponResponse = await $axios.$post('coupon', {
      event_id: eventId,
      status_id: statusId,
      code: coupon.code,
      discount_value: couponDiscountValue,
      discount_type: coupon.discountType.value,
      max_uses: coupon.maxUses,
      start_date: `${coupon.start_date}T${coupon.start_time}:00.000Z`,
      end_date: `${coupon.end_date}T${coupon.end_time}:00.000Z`,
    });

    if (!couponResponse.body || couponResponse.body.code !== 'CREATE_SUCCESS') {
      throw new Error('Failed to event coupon.');
    }

    const couponId = couponResponse.body.result.id;

    // Relaciona o campo aos ingressos especificados
    coupon.tickets.forEach((ticketName) => {
      if (!couponTicketMap[ticketName]) {
        couponTicketMap[ticketName] = [];
      }
      couponTicketMap[ticketName].push(couponId);
    });
  });

  await Promise.all(couponPromises);

  return couponTicketMap; // Retorna o mapeamento dos cupons para os ingressos
}

async function createCouponsWithoutTickets(eventId, coupons, statusId) {
  const couponPromises = coupons.map(async (coupon) => {
    const couponDiscountValue = parseFloat(coupon.discountValue.replace(',', '.'));

    const couponResponse = await $axios.$post('coupon', {
      event_id: eventId,
      status_id: statusId,
      code: coupon.code,
      discount_value: couponDiscountValue,
      discount_type: coupon.discountType.value,
      max_uses: coupon.maxUses,
      start_date: `${coupon.start_date}T${coupon.start_time}:00.000Z`,
      end_date: `${coupon.end_date}T${coupon.end_time}:00.000Z`,
    });

    if (!couponResponse.body || couponResponse.body.code !== 'CREATE_SUCCESS') {
      throw new Error('Failed to event coupon.');
    }
  });

  await Promise.all(couponPromises);
}

@Module({
  name: 'event',
  stateFactory: true,
  namespaced: true,
})
export default class Event extends VuexModule {
  private eventList = [];
  private isLoading: boolean = false;
  private isLoadingAlias: boolean = false;
  private isSaving: boolean = false;
  private isEditing: boolean = false;
  private isDeleting: boolean = false;
  private progressTitle: string = '';

  public get $eventList() {
    return this.eventList;
  }

  private event: any = {
    location_name: '',
    description: '',
    category_id: '',
    rating_id: '',
    start_date: '',
    end_date: '',
    name: '',
    event_type: '',
    address: {
      street: '',
      number: '',
      complement: '',
      neighborhood: '',
      city: '',
      state: '',
      zipcode: '',
    },
  };

  private copyEvent = null;

  public get $event() {
    if (!this.event) return null;

    return {
      ...this.event,

      location: `${this.event.address.street}, ${this.event.address.number} - ${this.event.address.neighborhood}, ${this.event.address.city} - ${this.event.address.state}`,
    };
  }

  public get $isLoading() {
    return this.isLoading;
  }

  public get $isLoadingAlias() {
    return this.isLoadingAlias;
  }

  public get $isSaving() {
    return this.isSaving;
  }

  public get $isEditing() {
    return this.isEditing;
  }

  public get $isDeleting() {
    return this.isDeleting;
  }

  public get $progressTitle() {
    return this.progressTitle;
  }

  @Mutation
  private SET_EVENT_LIST(data: any) {
    this.eventList = data.map((event: any) => ({
      ...event,
      location: `${event.address.street}, ${event.address.number} - ${event.address.neighborhood}, ${event.address.city} - ${event.address.city.state}`,
    }));
  }

  @Mutation
  private SET_EVENT(data: any) {
    const ticketsTypes = data.tickets.map((ticket) => ticket.name);

    const ticketSales = data.tickets.filter(
      (ticket) => ticket.total_quantity > ticket.remaining_quantity
    );

    this.event = {
      ...data,
      title: data.name,
      statusText: data.status.name,
      date: data.start_date,
      statistics: [
        {
          title: 'Visualizações',
          value: `${
            data.totalizers.totalViews === 0 ? 'Nenhuma' : `${data.totalizers.totalViews}`
          }`,
        },
        { title: 'Visibilidade', value: data.availability },
        {
          title: 'Tipos de ingressos',
          value: `${ticketsTypes.length === 0 ? 'Nenhum' : `${ticketsTypes.length}`}`,
        },
        {
          title: 'Cupons de Desconto',
          value: `${data.coupons.length === 0 ? 'Nenhum' : `${data.coupons.length}`}`,
        },
      ],
      sales: [
        { title: 'Ingressos Vendidos', value: ticketSales.length },
        {
          title: 'Vendas',
          value: formatRealValue(data.totalizers.totalSalesAmout),
        },
      ],
      promoters: data.collaborators.length,
      tickets: data.tickets.map((ticket) => ({
        ...ticket,
        id: ticket.id,
        name: ticket.name,
        price: ticket.price,
        sold: ticket.total_quantity - ticket.remaining_quantity,
        total: ticket.total_quantity,
        status: ticket.status.name,
        hasSales: ticket.total_quantity > ticket.remaining_quantity,
      })),
    };

    this.copyEvent = {
      ...this.event,
    };
  }

  @Mutation
  private SET_IS_LOADING(value: boolean) {
    this.isLoading = value;
  }

  @Mutation
  private SET_IS_LOADING_ALIAS(value: boolean) {
    this.isLoadingAlias = value;
  }

  @Mutation
  private SET_IS_SAVING(value: boolean) {
    this.isSaving = value;
  }

  @Mutation
  private SET_IS_EDITING(value: boolean) {
    this.isEditing = value;
  }

  @Mutation
  private SET_IS_DELETING(value: boolean) {
    this.isDeleting = value;
  }

  @Mutation
  private SET_PROGRESS_TITLE(value: string) {
    this.progressTitle = value;
  }

  @Action
  public setLoading(value: boolean) {
    this.context.commit('SET_IS_LOADING', value);
  }

  @Action
  public setEditing(value: boolean) {
    this.isEditing = value;
  }

  @Action
  public setDeleting(value: boolean) {
    this.isDeleting = value;
  }

  @Action
  public setProgressTitle(value: string) {
    this.context.commit('SET_PROGRESS_TITLE', value);
  }

  @Action
  public setSaving(value: boolean) {
    this.context.commit('SET_IS_SAVING', value);
  }

  @Action
  public setLoadingAlias(value: boolean) {
    this.context.commit('SET_IS_LOADING_ALIAS', value);
  }

  @Action
  public setEvent(data: any) {
    this.context.commit('SET_EVENT', data);
  }

  @Action
  public async fetchEvents({
    page = 1,
    limit = 12,
    search,
    sortBy,
    sortDesc,
  }: SearchPayload) {
    this.setLoading(true);

    const preloads = [
      'rating',
      'tickets:status',
      'status',
      'address',
      'category',
      'attachments',
      'coupons',
      'collaborators',
    ];

    const params = new URLSearchParams();

    params.append('page', page.toString());
    params.append('limit', limit.toString());

    sortBy.forEach((field: string, index: number) => {
      const order = sortDesc[index] ? 'desc' : 'asc';
      params.append('orderBy[]', `${field}:${order}`);
    });

    if (search) {
      params.append('search[name][o]', '_LIKE_');
      params.append('search[name][v]', encodeURIComponent(String(search)));
    }

    preloads.forEach((preload) => params.append('preloads[]', preload));

    return await $axios
      .$get(`events?${params.toString()}`)
      .then((response) => {
        if (response.body && response.body.code !== 'SEARCH_SUCCESS')
          throw new Error(response);

        this.setLoading(false);
        this.context.commit('SET_EVENT_LIST', response.body.result.data);
        return response;
      })
      .catch(() => {
        this.setLoading(false);
        return {
          data: 'Error',
          code: 'FIND_NOTFOUND',
          total: 0,
        };
      });
  }

  @Action
  public async getById(eventId: string) {
    this.setLoading(true);

    const preloads = [
      'rating',
      'tickets:status',
      'status',
      'address',
      'category',
      'attachments',
      'collaborators',
      'coupons',
    ];

    return await $axios
      .$get(
        `events?where[id][v]=${eventId}&${preloads
          .map((preload) => `preloads[]=${preload}`)
          .join('&')}`
      )
      .then((response) => {
        if (response.body && response.body.code !== 'SEARCH_SUCCESS')
          throw new Error(response);

        this.setLoading(false);

        this.context.commit('SET_EVENT', response.body.result.data[0]);
        return response;
      })
      .catch(() => {
        this.setLoading(false);
        return {
          data: 'Error',
          code: 'FIND_NOTFOUND',
          total: 0,
        };
      });
  }

  @Action
  public async validateAlias(alias: string) {
    this.setLoadingAlias(true);

    return await $axios
      .$get(`event/validate-alias/${alias}`)
      .then((response) => {
        if (response.body && response.body.code !== 'VALIDATE_SUCCESS')
          throw new Error(response);

        this.setLoadingAlias(false);

        return response.body.result;
      })
      .catch(() => {
        this.setLoadingAlias(false);
        return {
          data: 'Error',
          code: 'FIND_NOTFOUND',
          total: 0,
        };
      });
  }

  @Action
  public async postEvent(eventPayload) {
    try {
      this.setSaving(true);

      this.setProgressTitle('Salvando endereço');

      let addressId = null;

      if (eventPayload.event_type !== 'Online') {
        addressId = await createAddress(eventPayload);
      }

      const eventId = await createEvent(eventPayload, addressId);

      // Se houver banner, cria e faz upload
      if (eventPayload.banner) {
        const bannerId = await createEventBanner(eventId);

        const bannerUrl = await uploadEventBanner(bannerId, eventPayload.banner);

        await updateEventBanner(bannerId, bannerUrl);
      }

      // Se houver ingressos, cria e relaciona campos personalizados

      let ticketMap = {};

      if (eventPayload.tickets.length > 0) {
        this.setProgressTitle('Salvando ingressos e categorias');

        ticketMap = await createTicketsAndCategories(eventId, eventPayload.tickets);

        this.setProgressTitle('Salvando campos personalizados');

        // Se houver campos personalizados, cria e relaciona com os ingressos
        if (eventPayload.customFields.length > 0) {
          const fieldTicketMap = await createCustomFields(
            eventId,
            eventPayload.customFields
          );

          await createEventCheckoutFieldTicketRelations(fieldTicketMap, ticketMap);
        }
      }

      this.setProgressTitle('Salvando cupons de desconto');

      let couponTicketMap = {};

      // Se houver cupons, cria
      if (eventPayload.coupons.length > 0) {
        const statusResponse = await getStatusByModuleName('coupon', 'Disponível');

        const couponsWithTickets = eventPayload.coupons.filter(
          (coupon) => coupon.tickets.length > 0
        );
        const couponsWithoutTickets = eventPayload.coupons.filter(
          (coupon) => coupon.tickets.length === 0
        );

        if (couponsWithTickets.length > 0) {
          couponTicketMap = await createCouponsWithTickets(
            eventId,
            couponsWithTickets,
            statusResponse.id
          );
        }

        if (couponsWithoutTickets.length > 0) {
          await createCouponsWithoutTickets(
            eventId,
            couponsWithoutTickets,
            statusResponse.id
          );
        }
      }

      // Se tiver ingressos e cupons, relaciona-os
      if (Object.keys(ticketMap).length > 0 && Object.keys(couponTicketMap).length > 0) {
        await createCouponTicketRelations(couponTicketMap, ticketMap);
      }

      this.setSaving(false);

      return { success: true, eventId };
    } catch (error) {
      this.setSaving(false);
      console.error('Error creating event:', error);
      throw error;
    }
  }

  @Action
  public async fetchEventStatuses(payload) {
    try {
      const { status } = payload;

      const response = await $axios.$get(
        `statuses?where[name][v]=${status}&where[module][v]=event`,
        payload
      );

      if (!response.body || response.body.code !== 'SEARCH_SUCCESS') {
        throw new Error('Falha ao buscar lista de status de eventos.');
      }

      return { success: true, data: response.body.result.data[0] };
    } catch (error) {
      console.error('Error fetching event statuses:', error);
      throw error;
    }
  }

  @Action
  public async updateEvent(payload) {
    try {
      const response = await $axios.$patch('event', payload);

      if (!response.body || response.body.code !== 'UPDATE_SUCCESS') {
        throw new Error('Falha ao atualizar o evento.');
      }
      return { success: true, data: response.body.result };
    } catch (error) {
      console.error('Error updating event:', error);
      throw error;
    }
  }

  @Action
  public async deleteEvent(payload) {
    try {
      const { eventId } = payload;

      const response = await $axios.$delete(`event/${eventId}`);

      if (!response.body || response.body.code !== 'DELETE_SUCCESS') {
        throw new Error('Falha ao atualizar o evento.');
      }

      return { success: true, data: response.body.result };
    } catch (error) {
      console.error('Error deleting event:', error);
      throw error;
    }
  }
}
