import { Module, VuexModule, Mutation, Action } from 'vuex-module-decorators';
import { Coupon, ValidationResult } from '~/models/event';
import { $axios } from '@/utils/nuxt-instance';

@Module({
  name: 'eventCoupons',
  stateFactory: true,
  namespaced: true,
})
export default class EventCoupons extends VuexModule {
  private couponList: Coupon[] = [];

  public get $coupons() {
    return this.couponList;
  }

  @Mutation
  private SET_COUPONS(coupons: Coupon[]) {
    this.couponList = coupons;
  }

  @Mutation
  private ADD_COUPON(coupon: Coupon) {
    this.couponList.push(coupon);
  }

  @Mutation
  private UPDATE_COUPON({ index, coupon }: { index: number; coupon: Coupon }) {
    this.couponList[index] = coupon;
  }

  @Mutation
  private REMOVE_COUPON(index: number) {
    this.couponList.splice(index, 1);
  }

  @Action
  public setCoupons(coupons: Coupon[]) {
    this.context.commit('SET_COUPONS', coupons);
  }

  @Action
  public addCoupon(coupon: Coupon) {
    this.context.commit('ADD_COUPON', coupon);
  }

  @Action
  public updateCoupon(payload: { index: number; coupon: Coupon }) {
    this.context.commit('UPDATE_COUPON', payload);
  }

  @Action
  public removeCoupon(index: number) {
    this.context.commit('REMOVE_COUPON', index);
  }

  @Action
  public validateCoupons(): ValidationResult {
    const errors: string[] = [];
    const couponCodes = new Set<string>();

    this.couponList.forEach((coupon, index) => {
      // Validação de código duplicado
      if (couponCodes.has(coupon.code)) {
        errors.push(`Cupom com código "${coupon.code}" está duplicado`);
      }
      couponCodes.add(coupon.code);

      // Validações básicas
      if (!coupon.code?.trim()) {
        errors.push(`Cupom ${index + 1}: Código é obrigatório`);
      }

      if (!coupon.discount_type) {
        errors.push(`Cupom ${index + 1}: Tipo de desconto é obrigatório`);
      }

      if (!coupon.discount_value || parseFloat(coupon.discount_value) <= 0) {
        errors.push(`Cupom ${index + 1}: Valor do desconto deve ser maior que zero`);
      }

      if (coupon.discount_type?.value === 'PERCENTAGE' && parseFloat(coupon.discount_value) > 100) {
        errors.push(`Cupom ${index + 1}: Desconto percentual não pode ser maior que 100%`);
      }

      if (!coupon.max_uses || coupon.max_uses <= 0) {
        errors.push(`Cupom ${index + 1}: Número máximo de usos deve ser maior que zero`);
      }

      // Validação de datas
      if (!coupon.start_date || !coupon.start_time) {
        errors.push(`Cupom ${index + 1}: Data e hora de início são obrigatórios`);
      }

      if (!coupon.end_date || !coupon.end_time) {
        errors.push(`Cupom ${index + 1}: Data e hora de término são obrigatórios`);
      }

      if (coupon.start_date && coupon.start_time && coupon.end_date && coupon.end_time) {
        const startDate = new Date(`${coupon.start_date}T${coupon.start_time}`);
        const endDate = new Date(`${coupon.end_date}T${coupon.end_time}`);

        if (endDate <= startDate) {
          errors.push(`Cupom ${index + 1}: Data final deve ser maior que a data inicial`);
        }
      }

      if (!coupon.tickets?.length) {
        errors.push(`Cupom ${index + 1}: Selecione pelo menos um ingresso`);
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  @Action
  public async createCoupons(
    eventId: string
  ): Promise<Record<string, string[]>> {

    if (!this.couponList.length) return;

    try {

      const statusResponse = await this.getStatusByModuleName('coupon', 'Disponível');

      const [couponsWithTickets, couponsWithoutTickets] = this.couponList.reduce(
        (acc, coupon) => {
          acc[coupon.tickets.length > 0 ? 0 : 1].push(coupon);
          return acc;
        },
        [[], []]
      );

      const results = await Promise.all([
        couponsWithTickets.length > 0
          ? this.createCouponsWithTickets(eventId, couponsWithTickets, statusResponse.id)
          : {},
        couponsWithoutTickets.length > 0
          ? this.createCouponsWithoutTickets(eventId, couponsWithoutTickets, statusResponse.id)
          : null,
      ]);

      return results[0];

    } catch (error) {
      console.error('Erro ao criar cupons:', error);
      throw error;
    }
  }

  @Action
  public reset() {
    this.context.commit('SET_COUPONS', []);
  }

  private async getStatusByModuleName(module: string, name: string) {
    const response = await $axios.$get(
      `statuses?where[module][v]=${module}&where[name][v]=${name}`
    );

    if (!response.body || response.body.code !== 'SEARCH_SUCCESS') {
      throw new Error(`Falha ao buscar status do módulo: ${module}`);
    }

    return response.body.result.data[0];
  }


  private async createCouponsWithTickets(eventId: string, coupons: Coupon[], statusId: string) {
    const couponTicketMap = {}; // Mapeia cupom -> ingressos

    const couponPromises = coupons.map(async (coupon) => {
      const couponDiscountValue = parseFloat(coupon.discount_value.replace(',', '.'));

      // Converte as datas para o timezone correto
      const startDateTime = `${coupon.start_date}T${coupon.start_time}:00.000Z`;
      const endDateTime = `${coupon.end_date}T${coupon.end_time}:00.000Z`;

      const startDate = new Date(startDateTime);
      const endDate = new Date(endDateTime);

      const couponResponse = await $axios.$post('coupon', {
        event_id: eventId,
        status_id: statusId,
        code: coupon.code,
        discount_value: couponDiscountValue,
        discount_type: coupon.discount_type.value,
        max_uses: coupon.max_uses,
        start_date: startDate.toISOString().replace('Z', '-0300'),
        end_date: endDate.toISOString().replace('Z', '-0300'),
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

    return couponTicketMap;
  }

  private async createCouponsWithoutTickets(eventId: string, coupons: Coupon[], statusId: string) {
    const couponPromises = coupons.map(async (coupon) => {
      const couponDiscountValue = parseFloat(coupon.discount_value.replace(',', '.'));

      // Converte as datas para o timezone correto
      const startDateTime = `${coupon.start_date}T${coupon.start_time}:00.000Z`;
      const endDateTime = `${coupon.end_date}T${coupon.end_time}:00.000Z`;

      const startDate = new Date(startDateTime);
      const endDate = new Date(endDateTime);

      const couponResponse = await $axios.$post('coupon', {
        event_id: eventId,
        status_id: statusId,
        code: coupon.code,
        discount_value: couponDiscountValue,
        discount_type: coupon.discount_type.value,
        max_uses: coupon.max_uses,
        start_date: startDate.toISOString().replace('Z', '-0300'),
        end_date: endDate.toISOString().replace('Z', '-0300'),
      });

      if (!couponResponse.body || couponResponse.body.code !== 'CREATE_SUCCESS') {
        throw new Error('Failed to event coupon.');
      }
    });

    await Promise.all(couponPromises);
  }

} 